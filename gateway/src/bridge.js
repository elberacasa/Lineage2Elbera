// Bridges one browser WebSocket client to one L2 game session.
// Implements the FROZEN bridge contract (see gateway/README.md).
'use strict';

const crypto = require('crypto');
const { login } = require('./loginclient.js');
const { GameSession } = require('./gameclient.js');
const { npcName, npcLevel } = require('./npcnames.js');
const { questName } = require('./questnames.js');

// actionname-e.dat UI id -> aCis RequestSocialAction id. aCis carries no
// social NAMES (verified: RequestSocialAction relays the number only); the
// convention is retail socialname-e.dat: 2 Greeting, 3 Victory, 4 Advance,
// 5 No, 6 Yes, 7 Bow, 8 Unaware, 9 Waiting, 10 Laugh, 11 Applaud,
// 12 Dance, 13 Sorrow. Everything NOT a key here goes verbatim to
// RequestActionUse(0x45) — including non-social actionname ids 2..13
// (Attack 2, Exchange 3, Next Target 4, Pick Up 5, Assist 6, Invite 7,
// Leave Party 8, Dismiss 9, Party Matching 11), which aCis handles with
// their own packets (its RequestActionUse switch just warns on them).
const SOCIAL_UI_TO_ACIS = {
  12: 2, 13: 3, 14: 4, 25: 5, 24: 6, 26: 7,
  29: 8, 30: 9, 31: 10, 33: 11, 34: 12, 35: 13,
};
const SOCIAL_NAMES = {
  2: 'Greeting', 3: 'Victory', 4: 'Advance', 5: 'No', 6: 'Yes', 7: 'Bow',
  8: 'Unaware', 9: 'Waiting', 10: 'Laugh', 11: 'Applaud', 12: 'Dance', 13: 'Sorrow',
};

function deriveCredentials(deviceId) {
  const id = String(deviceId || 'anonymous');
  const h1 = crypto.createHash('sha256').update('l2vzla-account:' + id).digest('hex');
  const h2 = crypto.createHash('sha256').update('l2vzla-pass:' + id).digest('hex');
  return {
    account: 'w' + h1.slice(0, 12), // 13 chars, [a-z0-9]
    password: h2.slice(0, 16),
    charName: 'W' + h1.slice(12, 23), // 12 chars, alphanumeric, unique per device
  };
}

// Legacy first-login auto-create (default Human Fighter). Every existing
// test/test script logs in with a fresh deviceId and immediately enterChar
// slot 0, so it relies on this — default ON, disable with
// GATEWAY_AUTOCREATE=0, or per-session with login{noAutoCreate:true} (the
// browser then drives createChar itself from an empty auth_ok).
const AUTOCREATE = process.env.GATEWAY_AUTOCREATE !== '0';

// Character creation contract (aCis RequestCharacterCreate 0x0b — see
// README §character creation for the traps). Base classIds (ClassId.java
// ordinals, classBaseLevel 1) mapped to their race; classId is
// AUTHORITATIVE — aCis only range-checks the race field and takes the race
// from the class template, so the gateway derives race from classId and
// ignores the client-sent race.
const BASE_CLASS_RACE = { 0: 0, 10: 0, 18: 1, 25: 1, 31: 2, 38: 2, 44: 3, 49: 3, 53: 4 };
const CHAR_NAME_RE = /^[A-Za-z0-9]{1,16}$/; // aCis StringUtil.isValidString
// CharCreateFail(0x1a) reason codes (serverpackets/CharCreateFail.java).
const CREATE_FAIL_REASONS = {
  0: 'creation_failed',
  1: 'too_many_characters',
  2: 'name_already_exists',
  3: '16_eng_chars',
  4: 'incorrect_name',
};

class Bridge {
  constructor(ws, config, log) {
    this.ws = ws;
    this.config = config;
    this.log = log;
    this.game = null;
    this.selfId = 0;
    this.chars = [];
    this.pendingCreate = null;
    this.closed = false;
    // M3 combat state: merged attribute view per object id, and self stats.
    this.statusById = new Map(); // id -> {hp, maxHp, mp, maxMp}
    this.self = null; // {hp, maxHp, mp, maxMp, cp, maxCp, level, exp, sp}
    this.entered = false; // enterWorld must fire exactly once
    // Respawn vertical: SELF death state (Die 0x06 for own objectId). The
    // contract respawn{} op is only meaningful while dead (aCis
    // RequestRestartPoint silently drops it otherwise — guard here).
    this.dead = false;
    // M4: current target (for useSkill) and login-time list ordering. The
    // server sends SkillList/ItemList BEFORE UserInfo during EnterWorld, but
    // the contract wants them right AFTER enterWorld: queue and flush.
    this.currentTarget = 0;
    this.pendingSkillList = null;
    this.pendingItemList = null;
    this.pendingQuestList = null;
    // M9 party state: full snapshot rebuilt on every composition packet;
    // status updates flow as their own op (see README §M9 for the choice).
    this.party = { leaderId: 0, lootRule: 0, members: new Map() }; // id -> member
    this.selfInfo = null; // {id, name, classId, level, race} from UserInfo
    // M11 shop state: last merchant list id + inventory (objectId -> itemId)
    // to resolve RequestSellItem entries.
    this.lastBuyListId = 0;
    this.inventory = new Map();
    // M12 trade state: visible players id -> name (CharInfo). aCis
    // TradeRequest is objectId-based; the contract op is name-based, and
    // tradeAsk/tradeStart resolve ids back to names through this map.
    this.playersByName = new Map();
    // M13 private-store state: last manage type (routes storeTitle), own
    // open-store type (routes storeStop, drives storeState), store titles
    // per objectId (PrivateStoreMsg* broadcasts, folded into playerStore),
    // and the last observed store lists per storeId (resolve storeBuy
    // prices and storeSell itemId/enchant).
    this.storeManageType = null; // 'sell' | 'buy'
    this.ownStoreType = null; // 'sell' | 'buy' while a store is open
    this.storeTitles = new Map(); // objectId -> title
    this.playerStores = new Map(); // storeId -> {type, items}
    // M14 clan state: clan info (PledgeShowMemberListAll header merged with
    // PledgeShowInfoUpdate) and the member snapshot keyed by NAME
    // (PledgeShowMemberListDelete is name-based, and these packets never
    // carry an offline member's objectId). Like M9 party: FULL snapshot
    // re-emitted on every change, no incremental ops.
    this.clan = null; // {id, name, leaderName, level, crestId, allyId, allyName}
    this.clanMembers = new Map(); // name -> {id, name, level, classId, online}
    this.pendingClanInfo = null; // queued until after enterWorld (EnterWorld
    this.pendingClanMembers = null; // sends the clan packets BEFORE UserInfo)

    ws.on('message', (data) => this._onMessage(data));
    ws.on('close', () => this._shutdown());
    ws.on('error', () => this._shutdown());
  }

  send(obj) {
    if (!this.closed && this.ws.readyState === 1) this.ws.send(JSON.stringify(obj));
  }

  async _onMessage(data) {
    let msg;
    try {
      msg = JSON.parse(data);
    } catch (_) {
      return;
    }
    try {
      switch (msg.op) {
        case 'login':
          // noAutoCreate: skip the legacy first-login auto-create for THIS
          // session only (the world client sends it so a fresh account gets
          // auth_ok{chars:[]} and can drive createChar from the browser).
          await this._login(String(msg.deviceId || 'anonymous'), !!msg.noAutoCreate);
          break;
        case 'enterChar':
          if (this.game) this.game.selectChar(msg.slot | 0);
          break;
        case 'createChar': {
          // Character creation (aCis RequestCharacterCreate 0x0b). ALL fields
          // are validated gateway-side BEFORE touching aCis: the server does
          // not validate sex (sex >= 2 throws server-side with NO fail
          // packet) and treats race as decorative — race is derived from
          // classId here (classId authoritative), msg.race ignored.
          const invalid = validateCreateChar(msg);
          if (invalid) {
            this.send({ op: 'charCreateFail', reason: invalid });
            break;
          }
          if (!this.game || this.game.state !== 'AUTHED') {
            this.send({ op: 'charCreateFail', reason: 'not_ready' });
            break;
          }
          if (this.pendingCreate) {
            this.send({ op: 'charCreateFail', reason: 'create_in_progress' });
            break;
          }
          this.pendingCreate = msg.name;
          this.game.createCharacter({
            name: msg.name,
            race: BASE_CLASS_RACE[msg.classId],
            sex: msg.sex,
            classId: msg.classId,
            hairStyle: msg.hairStyle | 0,
            hairColor: msg.hairColor | 0,
            face: msg.face | 0,
          });
          break;
        }
        case 'moveTo':
          if (this.game) {
            this.game.pos = { ...this.game.pos, x: msg.x | 0, y: msg.y | 0, z: msg.z | 0 };
            this.game.moveTo(msg.x | 0, msg.y | 0, msg.z | 0);
          }
          break;
        case 'say':
          if (this.game) this.game.say(msg.channel | 0, String(msg.text || '').slice(0, 100), msg.target ? String(msg.target) : null);
          break;
        case 'target':
          // Action (0x04): plain click — target/interact. Also used to loot:
          // targeting a ground drop walks there and picks it up.
          if (this.game) this.game.action(msg.id | 0);
          break;
        case 'attack':
          // AttackRequest (0x0a): ctrl+click — force attack.
          if (this.game) this.game.attackRequest(msg.id | 0);
          break;
        case 'useSkill':
          // RequestMagicSkillUse. Optional targetId presets the target first.
          if (this.game) {
            const skillId = msg.skillId | 0;
            const targetId = msg.targetId | 0;
            if (targetId && targetId !== this.currentTarget) {
              this.game.action(targetId);
              setTimeout(() => { if (this.game) this.game.useSkill(skillId); }, 400);
            } else {
              this.game.useSkill(skillId);
            }
          }
          break;
        case 'useItem':
          if (this.game) this.game.useItem(msg.objectId | 0);
          break;
        case 'autoShot':
          // Toggle automatic soulshot/spiritshot use. itemId is the ITEM id
          // (1463 = Soulshot D...), not an inventory object id — the server
          // looks it up with getItemByItemId.
          if (this.game) this.game.autoSoulShot(msg.itemId | 0, !!msg.enable);
          break;
        case 'talk':
          // Talk/interact with an NPC. aCis Creature.onAction: first Action
          // only TARGETS; a second Action on the current target INTERACTS
          // (dialog) for non-attackable NPCs — and ATTACKS for attackable
          // ones (attackable-without-force) or with ctrl. So talk sends
          // Action twice; on attackable NPCs the second Action is a swing
          // (aCis routing, not packet-level — use the attack op for those).
          if (this.game) {
            const id = msg.id | 0;
            this.game.action(id);
            if (id !== this.currentTarget) {
              setTimeout(() => { if (this.game) this.game.action(id); }, 400);
            }
          }
          break;
        case 'bypass':
          // RequestBypassToServer(0x21) with the raw bypass command string.
          // EXCEPTION: TE* commands come from tutorial pages (originally
          // action="link TE.." — the bridge rewrites them to bypass links so
          // the client dialog renders them clickable). aCis routes them via
          // RequestTutorialLinkHtml(0x7b), NOT 0x21 (its bypass switch has
          // no TE branch — clientpackets/RequestBypassToServer.java).
          if (this.game) {
            const command = String(msg.command || '').slice(0, 200);
            if (/^TE\d*$/.test(command)) this.game.tutorialLink(command);
            else this.game.bypass(command);
          }
          break;
        case 'tutorialQuestionMark':
          // RequestTutorialQuestionMark(0x7d): D markId — the answer to a
          // tutorialQuestionMark op (aCis notifies the Tutorial script
          // "QM<markId>").
          if (this.game) this.game.tutorialQuestionMark(msg.markId | 0);
          break;
        case 'tutorialEvent':
          // RequestTutorialClientEvent(0x7e): D eventId — reports a UI event
          // the server armed with TutorialEnableClientEvent(0xa2).
          if (this.game) this.game.tutorialClientEvent(msg.eventId | 0);
          break;
        case 'action':
          // Character action. actionId is an actionname-e.dat UI id.
          // Social entries are remapped to aCis social ids and sent via
          // RequestSocialAction(0x1b); everything else goes verbatim to
          // RequestActionUse(0x45). ctrl/shift always false.
          if (this.game) {
            const actionId = msg.actionId | 0;
            const socialId = SOCIAL_UI_TO_ACIS[actionId];
            if (socialId !== undefined) {
              this.log(`action ${actionId} (UI) -> RequestSocialAction(${socialId}) ${SOCIAL_NAMES[socialId]}`);
              this.game.requestSocialAction(socialId);
            } else {
              this.game.requestActionUse(actionId);
            }
          }
          break;
        case 'respawn':
          // RequestRestartPoint(0x6d) type 0 = to village (the only
          // restart point the contract exposes; anything not 1/2/3/4/27
          // falls through to "to town" server-side). Guard: only while
          // dead — aCis silently ignores the packet for a living player.
          if (this.game && this.dead) this.game.requestRestartPoint(0);
          break;
        case 'questAbort':
          // RequestQuestAbort(0x64).
          if (this.game) this.game.requestQuestAbort(msg.id | 0);
          break;
        case 'partyInvite':
          // RequestJoinParty(0x29): S name, D lootRule (0 = ITEM_LOOTER).
          if (this.game) this.game.requestJoinParty(String(msg.name || '').slice(0, 16), 0);
          break;
        case 'partyAnswer':
          // RequestAnswerJoinParty(0x2a): D 1 accept / 0 refuse.
          if (this.game) this.game.answerJoinParty(msg.accept ? 1 : 0);
          break;
        case 'partyLeave':
          // RequestWithdrawParty(0x2b): empty.
          if (this.game) this.game.withdrawParty();
          break;
        case 'partyKick':
          // RequestOustPartyMember(0x2c): S name.
          if (this.game) this.game.oustPartyMember(String(msg.name || '').slice(0, 16));
          break;
        // ----------------------------------------------------- M14: clan
        case 'clanInvite': {
          // RequestJoinPledge(0x24): D targetId, D pledgeType. OBJECTID-based
          // in this rev (unlike party, which is name-based) — resolve the
          // name via the visible-players map (CharInfo), like tradeRequest.
          // pledgeType 0 = main clan. Server checks join conditions
          // (clan.checkClanJoinCondition) and the request expires after 15s.
          const name = String(msg.name || '').slice(0, 16);
          let id = 0;
          for (const [pid, pname] of this.playersByName) if (pname === name) { id = pid; break; }
          if (this.game && id) this.game.requestJoinPledge(id, 0);
          else this.log(`clanInvite: no visible player named "${name}"`);
          break;
        }
        case 'clanAnswer':
          // RequestAnswerJoinPledge(0x25): D 1 accept / 0 refuse.
          if (this.game) this.game.answerJoinPledge(msg.accept ? 1 : 0);
          break;
        case 'clanLeave':
          // RequestWithdrawPledge(0x26): empty. The clan LEADER cannot
          // withdraw (CLAN_LEADER_CANNOT_WITHDRAW) — dissolve is not bridged.
          if (this.game) this.game.withdrawPledge();
          break;
        case 'clanOust':
          // RequestOustPledgeMember(0x27): S name. Needs SP_DISMISS
          // privilege (leader has it); target must not be in combat.
          if (this.game) this.game.oustPledgeMember(String(msg.name || '').slice(0, 16));
          break;
        case 'clanCrestRequest':
          // RequestPledgeCrest(0x68): D crestId.
          if (this.game) this.game.requestPledgeCrest(msg.id | 0);
          break;
        case 'buy':
          // RequestBuyItem(0x1f) with the last BuyList's listId. Requires the
          // merchant as current target (client sends target{id} first).
          if (this.game && Array.isArray(msg.items)) {
            this.game.requestBuyItem(this.lastBuyListId, msg.items.slice(0, 50));
          }
          break;
        case 'sell':
          // RequestSellItem(0x1e, listId 0). itemId resolved from the
          // inventory map (RequestSellItem carries objectId+itemId+count).
          if (this.game && Array.isArray(msg.items)) {
            const items = msg.items.slice(0, 50).map((it) => ({
              objectId: it.objectId | 0,
              itemId: this.inventory.get(it.objectId | 0) || 0,
              count: it.count | 0,
            })).filter((it) => it.itemId > 0);
            this.game.requestSellItem(0, items);
          }
          break;
        case 'multisellChoose':
          // MultiSellChoose(0xa7): D listId, D entryId, D amount. Server-side
          // validated against the PreparedListContainer stored on the Player
          // when MultiSellList was sent — the npc must be the current folk
          // (talk/bypass first) and within interaction range.
          if (this.game) this.game.multiSellChoose(msg.listId | 0, msg.entryId | 0, msg.count | 0 || 1);
          break;
        // ---------------------------------------------- M16: warehouse
        case 'whDepositItems':
          // SendWarehouseDepositList(0x31): D count, per item D objectId,
          // D count. Deposits into the ACTIVE warehouse — set server-side by
          // the DepositP/DepositC bypass (talk to the keeper and follow the
          // real html link first). Fee: 30 adena PER ENTRY, charged by the
          // server. Adena is a normal entry (itemId 57, objectId from the
          // whDeposit list) — no special adena packet in this rev.
          if (this.game && Array.isArray(msg.items)) {
            this.game.whDepositItems(msg.items.slice(0, 50).map((it) => ({ objectId: it.objectId | 0, count: it.count | 0 })));
          }
          break;
        case 'whWithdrawItems':
          // SendWarehouseWithdrawList(0x32): same layout, from the active
          // warehouse (WithdrawP/WithdrawC bypass first).
          if (this.game && Array.isArray(msg.items)) {
            this.game.whWithdrawItems(msg.items.slice(0, 50).map((it) => ({ objectId: it.objectId | 0, count: it.count | 0 })));
          }
          break;
        case 'destroyItem':
          // inventory TrashButton (aCis RequestDestroyItem)
          if (this.game) this.game.destroyItem(msg.objectId | 0, msg.count | 0 || 1);
          break;
        case 'crystallizeItem':
          // inventory CrystallizeButton (aCis RequestCrystallizeItem)
          if (this.game) this.game.crystallizeItem(msg.objectId | 0, msg.count | 0 || 1);
          break;
        // ---------------------------------------------------- M12: trade
        case 'tradeRequest': {
          // TradeRequest(0x15) is objectId-based in this rev; the contract
          // op is name-based — resolve via the visible-players map (CharInfo).
          // Server-side the requestor must KNOW the target (Player.knows) and
          // the target must not be busy; request expires after 15s.
          const name = String(msg.name || '').slice(0, 16);
          let id = 0;
          for (const [pid, pname] of this.playersByName) if (pname === name) { id = pid; break; }
          if (this.game && id) this.game.tradeRequest(id);
          else this.log(`tradeRequest: no visible player named "${name}"`);
          break;
        }
        case 'tradeAnswer':
          // AnswerTradeRequest(0x44): D 1 accept / 0 refuse.
          if (this.game) this.game.answerTradeRequest(msg.accept ? 1 : 0);
          break;
        case 'tradeAdd':
          // AddTradeItem(0x16): D tradeId(unused, 0), D objectId, D count.
          if (this.game) this.game.addTradeItem(msg.objectId | 0, msg.count | 0);
          break;
        case 'tradeDone':
          // TradeDone(0x17) response 1 = confirm. TWO-PHASE in aCis: the
          // first confirm only marks the side (TradePressOwnOk/OtherOk);
          // the exchange happens when BOTH confirmed (TradeList.confirm).
          if (this.game) this.game.tradeDone(1);
          break;
        case 'tradeCancel':
          // TradeDone(0x17) response 0 = cancel the trade for BOTH parties.
          if (this.game) this.game.tradeDone(0);
          break;
        // ---------------------------------------------- M13: private stores
        case 'storeManageSell':
          // RequestPrivateStoreManageSell(0x73): open the sell manage view.
          if (this.game) {
            this.storeManageType = 'sell';
            this.game.requestPrivateStoreManageSell();
          }
          break;
        case 'storeManageBuy':
          // RequestPrivateStoreManageBuy(0x90): open the buy manage view.
          if (this.game) {
            this.storeManageType = 'buy';
            this.game.requestPrivateStoreManageBuy();
          }
          break;
        case 'storeTitle':
          // SetPrivateStoreMsgSell(0x77)/Buy(0x94), routed by the last
          // manage/set type. Set BEFORE storeSetSell/Buy so the store-open
          // broadcast carries the title (it survives TradeList.clear()).
          if (this.game) {
            const title = String(msg.title || '').slice(0, 29);
            if (this.storeManageType === 'buy') this.game.setPrivateStoreMsgBuy(title);
            else this.game.setPrivateStoreMsgSell(title);
          }
          break;
        case 'storeSetSell':
          // SetPrivateStoreListSell(0x74): D packageSale, D count, per item
          // D objectId, D count, D price. THIS OPENS THE STORE in aCis
          // (sitDown + OperateType.SELL + broadcast) — there is no separate
          // start packet. Optional title is sent first (see storeTitle).
          if (this.game && Array.isArray(msg.items)) {
            this.storeManageType = 'sell';
            if (typeof msg.title === 'string') this.game.setPrivateStoreMsgSell(msg.title.slice(0, 29));
            this.game.setPrivateStoreListSell(msg.items.slice(0, 50), !!msg.packageSale);
          }
          break;
        case 'storeSetBuy':
          // SetPrivateStoreListBuy(0x91): D count, per item D itemId,
          // H enchant, H 0, D count, D price. Opens the buy-store.
          if (this.game && Array.isArray(msg.items)) {
            this.storeManageType = 'buy';
            if (typeof msg.title === 'string') this.game.setPrivateStoreMsgBuy(msg.title.slice(0, 29));
            this.game.setPrivateStoreListBuy(msg.items.slice(0, 50));
          }
          break;
        case 'storeStart':
          // No-op: aCis has NO separate start packet — the store opens
          // inside SetPrivateStoreListSell/Buy (verified in the aCis
          // clientpackets: sitDown + setOperateType + broadcast).
          this.log('storeStart: no-op (aCis opens the store in storeSetSell/storeSetBuy)');
          break;
        case 'storeStop':
          // RequestPrivateStoreQuitSell(0x76)/QuitBuy(0x93). Both just set
          // OperateType.NONE + broadcastUserInfo, so either closes any store.
          if (this.game) {
            if (this.ownStoreType === 'buy') this.game.requestPrivateStoreQuitBuy();
            else this.game.requestPrivateStoreQuitSell();
          }
          break;
        case 'storeBuy': {
          // RequestPrivateStoreBuy(0x79): buy FROM someone's sell-store.
          // The packet needs the store price per item (server validates
          // objectId+price against the TradeList) — resolved from the last
          // playerStore list seen for storeId.
          const store = this.playerStores.get(msg.storeId | 0);
          if (this.game && store && store.type === 'sell' && Array.isArray(msg.items)) {
            const priceByOid = new Map(store.items.map((it) => [it.objectId, it.price]));
            const items = msg.items.slice(0, 50)
              .map((it) => ({ objectId: it.objectId | 0, count: it.count | 0, price: it.price | 0 || priceByOid.get(it.objectId | 0) || 0 }))
              .filter((it) => it.objectId > 0 && it.count > 0 && it.price > 0);
            if (items.length) this.game.requestPrivateStoreBuy(msg.storeId | 0, items);
            else this.log(`storeBuy: no known prices for store ${msg.storeId} (click the store first)`);
          }
          break;
        }
        case 'storeSell': {
          // RequestPrivateStoreSell(0x96): sell INTO someone's buy-store.
          // itemId/enchant resolved from the last playerStore list (the
          // observer view of a buy-store carries the VIEWER's own items).
          const store = this.playerStores.get(msg.storeId | 0);
          if (this.game && store && store.type === 'buy' && Array.isArray(msg.items)) {
            const byOid = new Map(store.items.map((it) => [it.objectId, it]));
            const items = msg.items.slice(0, 50)
              .map((it) => {
                const ref = byOid.get(it.objectId | 0);
                return {
                  objectId: it.objectId | 0,
                  itemId: ref ? ref.itemId : (this.inventory.get(it.objectId | 0) || 0),
                  enchant: ref ? ref.enchant : 0,
                  count: it.count | 0,
                  price: it.price | 0 || (ref ? ref.price : 0),
                };
              })
              .filter((it) => it.objectId > 0 && it.itemId > 0 && it.count > 0 && it.price > 0);
            if (items.length) this.game.requestPrivateStoreSell(msg.storeId | 0, items);
            else this.log(`storeSell: no resolvable items for store ${msg.storeId} (click the store first)`);
          }
          break;
        }
      }
    } catch (e) {
      this.log(`bridge error: ${e.message}`);
    }
  }

  async _login(deviceId, noAutoCreate = false) {
    if (this.game) return; // already logged in
    const creds = deriveCredentials(deviceId);
    this.log(`login: device=${deviceId} account=${creds.account}`);

    // Retry the whole login+game-connect flow. The servers' hardcoded
    // IPv4Filter bans fast reconnects for 300s and every attempt refreshes
    // the ban — so keep retries few and let it expire instead of hammering.
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        await this._loginOnce(creds, noAutoCreate);
        return;
      } catch (e) {
        this.log(`login attempt ${attempt} failed: ${e.message}`);
        if (this.game) {
          this.game.close();
          this.game = null;
        }
        if (attempt < 2) await new Promise((r) => setTimeout(r, 4000));
      }
    }
  }

  async _loginOnce(creds, noAutoCreate) {
    const { sessionKey, server } = await login(
      this.config.loginHost, this.config.loginPort,
      creds.account, creds.password, this.config.serverId
    );
    this.log(`login ok: server [${server.id}] ${server.host}:${server.port}`);

    const game = new GameSession();
    this.game = game;
    this._wireGame(game, creds, noAutoCreate);

    // Resolve when the game session reaches the char list, reject on early close.
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('timed out waiting for CharSelectInfo')), 15000);
      game.once('charList', () => { clearTimeout(timer); resolve(); });
      game.once('close', () => { clearTimeout(timer); reject(new Error(`game socket closed (state=${game.state})`)); });
      game.once('error', (e) => { clearTimeout(timer); reject(e); });
      game.connect(server.host, server.port, creds.account, sessionKey);
    });

    // Login sequence complete: from now on, a game socket loss ends the WS session.
    game.on('close', () => {
      this.log(`game socket closed (state=${game.state})`);
      this._shutdown();
    });
  }

  _wireGame(game, creds, noAutoCreate = false) {
    game.on('error', (e) => this.log(`game socket error: ${e.message}`));
    game.on('debug', (m) => this.log(`game: ${m}`));
    game.on('parseError', ({ op, error }) => this.log(`parse error op=0x${op.toString(16)}: ${error.message}`));

    game.on('charList', (chars) => {
      if (chars.length === 0 && !this.pendingCreate && AUTOCREATE && !noAutoCreate) {
        // Legacy first-login path: auto-create a default Human Fighter.
        // Skipped with GATEWAY_AUTOCREATE=0 or login{noAutoCreate:true} —
        // the empty auth_ok below lets the client drive createChar itself.
        this.pendingCreate = creds.charName;
        this.log(`no characters, creating ${creds.charName}`);
        game.createCharacter({ name: creds.charName, race: 0, sex: 0, classId: 0 });
        return;
      }
      this.chars = chars;
      this.send({
        op: 'auth_ok',
        chars: chars.map((c) => ({
          slot: c.slot, name: c.name, race: c.race, classId: c.classId,
          sex: c.sex, level: c.level,
          hairStyle: c.hairStyle, hairColor: c.hairColor, face: c.face,
        })),
      });
    });

    // CharCreateOk(0x19)/CharCreateFail(0x1a): a successful create is
    // followed by a FRESH CharSelectInfo (the charList handler above
    // re-fires and sends the updated auth_ok). On failure nothing else
    // follows — without these forwards the browser hung forever.
    game.on('charCreateOk', () => {
      this.pendingCreate = null;
      this.send({ op: 'charCreateOk' });
    });
    game.on('charCreateFail', (code) => {
      this.pendingCreate = null;
      this.send({ op: 'charCreateFail', reason: CREATE_FAIL_REASONS[code] || 'creation_failed', code });
    });

    game.on('userInfo', (u) => {
      this.selfId = u.id;
      this.selfInfo = { id: u.id, name: u.name, classId: u.classId, level: u.level, race: u.race };
      // Seed/refresh self stats; UserInfo re-sends (level up, stat changes)
      // must NOT re-emit enterWorld — only the first one does.
      this.self = {
        hp: u.hp, maxHp: u.maxHp, mp: u.mp, maxMp: u.maxMp,
        cp: u.cp, maxCp: u.maxCp, level: u.level, exp: u.exp, sp: u.sp,
      };
      if (!this.entered) {
        this.entered = true;
        // sex/hairStyle/hairColor/face are NOT in UserInfo (it discards
        // them) — source them from the selected char's CharSelectInfo entry
        // (this.chars, parsed with those fields and refreshed after creates).
        const sel = (this.chars || []).find(c => c.charId === u.id || c.name === u.name) || {};
        this.send({
          op: 'enterWorld',
          char: {
            id: u.id, name: u.name, race: u.race, classId: u.classId,
            sex: sel.sex ?? u.sex ?? 0,
            hairStyle: sel.hairStyle ?? 0, hairColor: sel.hairColor ?? 0, face: sel.face ?? 0,
            x: u.x, y: u.y, z: u.z, heading: u.heading,
          },
        });
        // Flush login-time lists right after enterWorld (contract order).
        if (this.pendingSkillList) {
          this.send({ op: 'skillList', skills: this.pendingSkillList });
          this.pendingSkillList = null;
        }
        if (this.pendingItemList) {
          this.send({ op: 'itemList', items: this.pendingItemList });
          this.pendingItemList = null;
        }
        if (this.pendingQuestList) {
          this.send({ op: 'questList', quests: this.pendingQuestList });
          this.pendingQuestList = null;
        }
        if (this.pendingClanInfo) {
          // EnterWorld sends PledgeShowMemberListAll BEFORE UserInfo
          // (EnterWorld.java:164 vs :223), so clan ops queue like the lists.
          this.send(this.pendingClanInfo);
          this.pendingClanInfo = null;
        }
        if (this.pendingClanMembers) {
          this.send({ op: 'clanMembers', members: this.pendingClanMembers });
          this.pendingClanMembers = null;
        }
      }
      // storeState: UserInfo carries OperateType (writeC after mountType).
      // 1 SELL / 8 PACKAGE_SELL -> 'sell', 3 BUY -> 'buy'; 2/4 are the
      // manage views (store NOT visible to observers), 0 NONE. Emitted on
      // transitions only; covers storeSet*, storeStop and the auto-close
      // when a store sells out (OperateType.NONE + broadcastUserInfo).
      const STORE_OPEN = { 1: 'sell', 3: 'buy', 8: 'sell' };
      const nowType = STORE_OPEN[u.operateType] || null;
      if (nowType !== this.ownStoreType) {
        if (this.ownStoreType) this.send({ op: 'storeState', open: false });
        this.ownStoreType = nowType;
        if (nowType) this.send({ op: 'storeState', open: true, type: nowType });
      }
      this.send({ op: 'selfStatus', ...this.self });
      // charSheet: sent right after enterWorld (first UserInfo) and again on
      // every UserInfo re-send (stat changes).
      this.send({
        op: 'charSheet',
        str: u.str, dex: u.dex, con: u.con, int: u.int, wit: u.wit, men: u.men,
        pAtk: u.pAtk, pDef: u.pDef, mAtk: u.mAtk, mDef: u.mDef,
        accuracy: u.accuracy, evasion: u.evasion, critical: u.critical,
        runSpeed: u.runSpeed, walkSpeed: u.walkSpeed,
        pAtkSpd: u.pAtkSpd, mAtkSpd: u.mAtkSpd,
        // Attack cadence and swing-animation rate. pAtkSpd feeds
        // Formulas.calculateTimeBetweenAttacks = max(100, 500000 / pAtkSpd);
        // atkSpdMul is CreatureStatus.getAttackSpeedMultiplier(), which aCis
        // documents as the value "used by client to set correct
        // character/object attack speed".
        atkSpdMul: u.atkSpdMul,
        // walk/run stance (UserInfo isRunning byte). setRunning(true) at world
        // entry never broadcasts ChangeMoveType, so without this the client has
        // to guess the stance.
        running: u.running,
        maxLoad: u.maxLoad,
        // equipped item ids (UserInfo's 17-slot layout) — what the client
        // renders in the hand and on the body
        paperdoll: u.paperdoll,
      });
    });

    // ExAutoSoulShot — the server's confirmation that the toggle took. Only
    // arrives on success, so the client should drive its shot indicator from
    // this rather than from its own optimistic click.
    game.on('autoShot', (s) => {
      this.send({ op: 'autoShotState', itemId: s.itemId, enabled: s.enabled });
    });

    game.on('npcInfo', (n) => {
      this.send({
        op: 'addNpc',
        id: n.id,
        npcId: n.npcId,
        name: n.name || npcName(n.npcId),
        // aCis 409 NpcInfo carries no level: prefer the live "Lv N" title
        // prefix (ShowNpcLevel), else the datapack template level, else null.
        level: n.level ?? npcLevel(n.npcId),
        x: n.x, y: n.y, z: n.z, heading: n.heading,
        // L2 units/s, straight from NpcInfo — the client animates with these
        // instead of one constant for every creature in the game
        runSpeed: n.runSpeed, walkSpeed: n.walkSpeed, running: n.running,
        // attack cadence / swing rate, same fields and same meaning as on
        // charSheet (NpcInfo carries them per creature)
        pAtkSpd: n.pAtkSpd, mAtkSpd: n.mAtkSpd, atkSpdMul: n.atkSpdMul,
        // right-hand item id: the client resolves the aCis WeaponType from it
        // (itemtypes.json) to pick the CreatureAttack branch for hit timing
        rhand: n.rhand, lhand: n.lhand,
      });
    });

    game.on('charInfo', (c) => {
      if (c.id === this.selfId) return;
      this.playersByName.set(c.id, c.name);
      this.send({
        op: 'addPlayer',
        id: c.id,
        name: c.name,
        race: c.race,
        classId: c.classId,
        // aCis 409 CharInfo carries no level field; unavailable in-protocol.
        level: null,
        x: c.x, y: c.y, z: c.z, heading: c.heading,
        // equipped item ids (CharInfo's 12-slot layout — a different order
        // from UserInfo's, see readPaperdollItems)
        paperdoll: c.paperdoll,
        // attack cadence / swing rate / walk-run stance, same fields and same
        // meaning as on charSheet (CharInfo carries them per player)
        pAtkSpd: c.pAtkSpd, mAtkSpd: c.mAtkSpd, atkSpdMul: c.atkSpdMul,
        running: c.running,
      });
    });

    game.on('move', (m) => {
      if (m.id === this.selfId) {
        this.send({ op: 'move', id: m.id, tx: m.tx, ty: m.ty, tz: m.tz });
        return;
      }
      this.send({ op: 'move', id: m.id, tx: m.tx, ty: m.ty, tz: m.tz });
    });

    game.on('teleport', (t) => {
      if (t.id === this.selfId) {
        this.game.pos = { ...this.game.pos, x: t.x, y: t.y, z: t.z };
        // aCis keeps _isTeleporting until the client answers with
        // Appearing(0x30) (clientpackets/Appearing.java -> onTeleported);
        // while set, denyAiAction() rejects interacts/attacks silently.
        this.game.appearing();
      }
      this.send({ op: 'move', id: t.id, tx: t.x, ty: t.y, tz: t.z });
    });

    game.on('validate', (v) => {
      if (v.id === this.selfId) this.game.pos = { x: v.x, y: v.y, z: v.z, heading: v.heading };
      this.send({ op: 'move', id: v.id, tx: v.x, ty: v.y, tz: v.z });
    });

    game.on('delete', (id) => {
      this.playersByName.delete(id);
      this.playerStores.delete(id);
      this.storeTitles.delete(id);
      this.send({ op: 'remove', id });
    });

    game.on('say', (s) => {
      const msg = { op: 'chat', from: s.name, channel: s.channel, text: s.text };
      // TELL (2): the packet's name is the other party. The sender's own echo
      // arrives as "->targetName" (chathandlers/ChatTell.java); strip it.
      if (s.channel === 2) msg.target = s.name.startsWith('->') ? s.name.slice(2) : s.name;
      this.send(msg);
    });

    // ---------------------------------------------------------- M3 combat

    // StatusType ids (enums/StatusType.java): LEVEL 1, EXP 2, CUR_HP 9,
    // MAX_HP 10, CUR_MP 11, MAX_MP 12, SP 13, CUR_CP 33, MAX_CP 34.
    game.on('statusUpdate', ({ id, attrs }) => {
      if (id === this.selfId) {
        if (!this.self) {
          this.self = { hp: 0, maxHp: 0, mp: 0, maxMp: 0, cp: 0, maxCp: 0, level: 0, exp: 0, sp: 0 };
        }
        let touched = false;
        for (const a of attrs) {
          switch (a.type) {
            case 1: this.self.level = a.value; touched = true; break;
            case 2: this.self.exp = a.value; touched = true; break;
            case 9: this.self.hp = a.value; touched = true; break;
            case 10: this.self.maxHp = a.value; touched = true; break;
            case 11: this.self.mp = a.value; touched = true; break;
            case 12: this.self.maxMp = a.value; touched = true; break;
            case 13: this.self.sp = a.value; touched = true; break;
            case 33: this.self.cp = a.value; touched = true; break;
            case 34: this.self.maxCp = a.value; touched = true; break;
          }
        }
        if (touched) this.send({ op: 'selfStatus', ...this.self });
        return;
      }
      const cur = this.statusById.get(id) || { hp: 0, maxHp: 0, mp: 0, maxMp: 0 };
      let touched = false;
      for (const a of attrs) {
        if (a.type === 9) { cur.hp = a.value; touched = true; }
        else if (a.type === 10) { cur.maxHp = a.value; touched = true; }
        else if (a.type === 11) { cur.mp = a.value; touched = true; }
        else if (a.type === 12) { cur.maxMp = a.value; touched = true; }
      }
      this.statusById.set(id, cur);
      if (touched) this.send({ op: 'status', id, hp: cur.hp, maxHp: cur.maxHp, mp: cur.mp, maxMp: cur.maxMp });
    });

    game.on('attack', ({ attackerId, hits }) => {
      for (let i = 0; i < hits.length; i++) {
        const h = hits[i];
        this.send({
          op: 'attack',
          id: attackerId,
          targetId: h.targetId,
          damage: h.damage,
          // Position inside the SAME Attack packet. aCis applies the hits of
          // one swing at different times (CreatureAttack.onHitTimer: a dual
          // wield lands hit 0, then hit 1 one _afterAttackDelay later), so the
          // client cannot reproduce the cadence from a flat stream of ops.
          hitIndex: i,
          hitCount: hits.length,
          // Attack.java: HITFLAG_SS 0x10, CRIT 0x20, SHLD 0x40, MISS 0x80.
          // The soulshot bit is how a shot becomes visible at all — there is
          // no separate packet for it, the flash and its sound ride the blow.
          soulshot: (h.flags & 0x10) !== 0,
          critical: (h.flags & 0x20) !== 0,
          shield: (h.flags & 0x40) !== 0,
          miss: (h.flags & 0x80) !== 0,
        });
      }
    });

    // Die(0x06) now carries the parsed respawn options (gameclient.js).
    // Contract: non-self deaths stay `die{id}`; a SELF death adds
    // `canRespawn` (aCis always allows "to village" — the flag is its
    // toVillage dword) so the client can show the Respawn button.
    game.on('die', (d) => {
      if (d.id === this.selfId) {
        this.dead = true;
        this.send({ op: 'die', id: d.id, canRespawn: d.toVillage });
      } else {
        this.send({ op: 'die', id: d.id });
      }
    });
    // Revive(0x07): clears the dead state for self (respawn accepted,
    // skill res, GM res). The respawn teleport itself arrives as the
    // regular move op (TeleportToLocation handler above).
    game.on('revive', (id) => {
      if (id === this.selfId) this.dead = false;
      this.send({ op: 'revive', id });
    });
    game.on('myTarget', (t) => {
      this.currentTarget = t.id;
      // color = MyTargetSelected color: viewer level - target level for
      // attackable targets (the retail con-color basis), 0 otherwise.
      this.send({ op: 'target_ok', id: t.id, color: t.color });
    });

    game.on('systemMessage', (sm) => {
      this.send({ op: 'sysMsg', id: sm.id, params: sm.params.map((p) => p.value) });
    });

    // ------------------------------------------------------ M4: skills & items

    game.on('skillList', (skills) => {
      // SkillList (0x58) carries per skill: passive flag, level, id, disabled
      // flag. The retail client keys its skill window off exactly these --
      // ESkillCategory{SKILL_Active, SKILL_Passive} and the `Lock` field --
      // so both are forwarded rather than dropped.
      const mapped = skills.map((s) => ({
        id: s.id, level: s.level, passive: !!s.passive, disabled: !!s.disabled,
      }));
      if (this.entered) this.send({ op: 'skillList', skills: mapped });
      else this.pendingSkillList = mapped;
    });

    game.on('skillUse', (s) => {
      this.send({
        op: 'skillCast',
        casterId: s.casterId,
        targetId: s.targetId,
        skillId: s.skillId,
        level: s.level,
        hitTime: s.hitTime,
        reuse: s.reuse, // reuse delay in MILLISECONDS (MagicSkillUse field)
      });
    });

    game.on('skillLaunch', (s) => {
      // Contract shape carries a single targetId; emit one op per target.
      for (const targetId of (s.targetIds.length ? s.targetIds : [0])) {
        this.send({ op: 'skillLaunch', casterId: s.casterId, targetId, skillId: s.skillId, level: s.level });
      }
    });

    game.on('itemList', (items) => {
      for (const it of items) this.inventory.set(it.objectId, it.itemId);
      if (this.entered) this.send({ op: 'itemList', items });
      else this.pendingItemList = items;
    });

    // ItemState ordinals (enums/items/ItemState.java): 0 UNCHANGED,
    // 1 ADDED, 2 MODIFIED, 3 REMOVED.
    game.on('invUpdate', (updated) => {
      for (const it of updated) {
        if (it.change === 3) this.inventory.delete(it.objectId);
        else this.inventory.set(it.objectId, it.itemId);
      }
      const CHANGE = ['unchanged', 'add', 'modify', 'remove'];
      this.send({
        op: 'invUpdate',
        updated: updated.map((it) => ({
          change: CHANGE[it.change] || String(it.change),
          objectId: it.objectId,
          itemId: it.itemId,
          count: it.count,
          slot: it.slot,
          equipped: it.equipped,
          enchant: it.enchant,
        })),
      });
    });

    // Merchant shops: BuyList (store it for RequestBuyItem) and SellList.
    game.on('buyList', (b) => {
      this.lastBuyListId = b.listId;
      this.send({ op: 'buyList', listId: b.listId, money: b.money, items: b.items });
    });
    game.on('sellList', (s) => {
      this.send({ op: 'sellList', money: s.money, items: s.items });
    });

    // MultiSellList (0xd0): pages already merged by the game client; the
    // contract op is the full list (entryId = 1-based index into the
    // server-side prepared list — use it verbatim in multisellChoose).
    game.on('multiSellList', (m) => {
      this.send({
        op: 'multisellList',
        listId: m.listId,
        items: m.items.map((e) => ({ entryId: e.entryId, products: e.products, ingredients: e.ingredients })),
      });
    });

    // Warehouse lists (0x41/0x42): whDeposit = own inventory items eligible
    // for deposit into the ACTIVE warehouse (set by the DepositP bypass);
    // whWithdraw = the active warehouse's contents. Both carry current adena
    // and whType (1 private, 2 clan, 3 castle, 4 freight).
    game.on('whDepositList', (w) => {
      this.send({ op: 'whDeposit', whType: w.whType, adena: w.adena, items: w.items });
    });
    game.on('whWithdrawList', (w) => {
      this.send({ op: 'whWithdraw', whType: w.whType, adena: w.adena, items: w.items });
    });

    game.on('drop', (d) => {
      this.send({ op: 'addDrop', id: d.id, itemId: d.itemId, count: d.count, x: d.x, y: d.y, z: d.z });
    });

    // QuestList (0x80): after enterWorld (queued) and on every re-send.
    // progress = raw QuestState flags dword (bit31 = started, low bits =
    // cond mask per QuestState.calculateFlags) — passed through uninterpreted.
    game.on('questList', (quests) => {
      const mapped = quests.map((q) => ({ id: q.id, name: questName(q.id), progress: q.flags }));
      if (this.entered) this.send({ op: 'questList', quests: mapped });
      else this.pendingQuestList = mapped;
    });

    // ------------------------------------------------------------ M9 party
    game.on('partyAsk', (a) => this.send({ op: 'partyAsk', from: a.from }));

    game.on('partyAll', (p) => {
      // PartySmallWindowAll excludes the receiver: rebuild with self.
      this.party.leaderId = p.leaderId;
      this.party.lootRule = p.lootRule;
      this.party.members = new Map(p.members.map((m) => [m.id, m]));
      this._sendPartySnapshot();
    });

    game.on('partyAdd', (p) => {
      this.party.leaderId = p.leaderId;
      this.party.lootRule = p.lootRule;
      this.party.members.set(p.member.id, p.member);
      this._sendPartySnapshot();
    });

    game.on('partyDelete', (d) => {
      this.party.members.delete(d.id);
      this._sendPartySnapshot();
    });

    game.on('partyDeleteAll', () => {
      this.party = { leaderId: 0, lootRule: 0, members: new Map() };
      this._sendPartySnapshot();
    });

    game.on('partyUpdate', (u) => {
      const m = this.party.members.get(u.id);
      if (m) Object.assign(m, u);
      this.send({
        op: 'partyMemberStatus',
        id: u.id, hp: u.hp, maxHp: u.maxHp, mp: u.mp, maxMp: u.maxMp,
      });
    });

    // ------------------------------------------------------------- M14 clan
    // AskJoinPledge(0x32) carries the requestor objectId; resolve to a name
    // via the visible-players map (same pattern as tradeAsk).
    game.on('clanAsk', (a) => {
      this.send({ op: 'clanAsk', from: this.playersByName.get(a.fromId) || String(a.fromId), clanName: a.clanName });
    });

    // JoinPledge(0x33, to the new member on accept): decoded, log-only —
    // the PledgeShowMemberListAll that follows carries everything.
    game.on('clanJoined', (clanId) => this.log(`clan: JoinPledge ${clanId}`));

    // PledgeShowMemberListAll(0x53): full clan info (header) + member list.
    // Sub-pledge lists (pledgeType != 0: academy/royal/knight) are NOT
    // bridged — the contract models the main clan only.
    game.on('clanAll', (p) => {
      if (p.pledgeType !== 0) return;
      this.clan = {
        id: p.clanId, name: p.name, leaderName: p.leaderName, level: p.level,
        crestId: p.crestId, allyId: p.allyId, allyName: p.allyName,
      };
      this.clanMembers = new Map(p.members.map((m) => [m.name, pledgeMemberView(m)]));
      this._sendClanInfo();
      this._sendClanMembers();
    });

    // PledgeShowMemberListAdd(0x55): a member joined (existing members' view).
    game.on('clanMemberAdd', (m) => {
      this.clanMembers.set(m.name, pledgeMemberView(m));
      this._sendClanMembers();
    });

    // PledgeShowMemberListUpdate(0x54): member login/logout/level refresh
    // (also broadcast when a clanmate logs in — EnterWorld.java:122).
    game.on('clanMemberUpdate', (m) => {
      const cur = this.clanMembers.get(m.name);
      if (!cur) return; // login-time self update; the All packet follows
      Object.assign(cur, pledgeMemberView(m));
      this._sendClanMembers();
    });

    // PledgeShowMemberListDelete(0x56): name-based (a member left/was ousted).
    game.on('clanMemberDelete', (name) => {
      if (this.clanMembers.delete(name)) this._sendClanMembers();
    });

    // PledgeShowMemberListDeleteAll(0x82): YOU left / were ousted / the clan
    // was dissolved. Clears the clan state: clanInfo{id:0} + empty members.
    game.on('clanDeleteAll', () => {
      this.clan = null;
      this.clanMembers = new Map();
      this._sendClanInfo();
      this._sendClanMembers();
    });

    // PledgeShowInfoUpdate(0x88): crest/level/ally changes, broadcast to all
    // members. Carries NO clan name / leader name — merge into local state.
    game.on('clanInfoUpdate', (u) => {
      if (!this.clan || this.clan.id !== u.clanId) return;
      Object.assign(this.clan, { crestId: u.crestId, level: u.level, allyId: u.allyId, allyName: u.allyName });
      this._sendClanInfo();
    });

    // PledgeInfo(0x83, answer to RequestPledgeInfo — not sent proactively):
    // merge name/allyName when it matches our clan.
    game.on('clanPledgeInfo', (p) => {
      if (!this.clan || this.clan.id !== p.id) return;
      this.clan.name = p.name;
      this.clan.allyName = p.allyName;
      this._sendClanInfo();
    });

    // PledgeStatusChanged(0xcd, rides RequestPledgeInfo answers): decoded,
    // log-only — not a contract op.
    game.on('clanStatusChanged', (s) => this.log(`clan: statusChanged clan=${s.clanId} crest=${s.crestId}`));

    // PledgeCrest(0x6c): raw DDS bytes (CrestCache stores .dds files, pledge
    // crest max 256 bytes per RequestSetPledgeCrest). data = base64 or null
    // (crestId without data). OPTIONAL contract op — the web client may not
    // decode DDS.
    game.on('clanCrest', (c) => {
      this.send({ op: 'clanCrest', id: c.id, data: c.data ? c.data.toString('base64') : null });
    });

    // ------------------------------------------------- M10: buffs & reuse
    // AbnormalStatusUpdate is a FULL SNAPSHOT of self effects each time
    // (built fresh with all current buffs+debuffs on every add/remove).
    // duration is in SECONDS from the packet; -1 = toggle/infinite.
    game.on('abnormal', (effects) => this.send({ op: 'buffs', effects }));

    // SkillCoolTime: reuse + remaining in SECONDS (packet divides by 1000).
    game.on('coolTime', (skills) => this.send({ op: 'skillCoolTime', skills }));

    // ------------------------------------------------------------ M12 trade
    // SendTradeRequest(0x5e) carries the requestor objectId; resolve to name
    // via the visible-players map (server guarantees the requestor is known).
    game.on('tradeAsk', (a) => {
      this.send({ op: 'tradeAsk', from: this.playersByName.get(a.fromId) || String(a.fromId) });
    });

    // TradeStart(0x1e): session open. items = own tradable inventory
    // snapshot (the packet's payload), forwarded uninterpreted.
    game.on('tradeStart', (t) => {
      this.send({
        op: 'tradeStart',
        partnerId: t.partnerId,
        partner: this.playersByName.get(t.partnerId) || null,
        items: t.items,
      });
    });

    // TradeOwnAdd(0x20)/TradeOtherAdd(0x21): per-add packets (H count is
    // always 1 in this rev); forwarded as one-item lists.
    game.on('tradeOwnAdd', (items) => this.send({ op: 'tradeOwn', items }));
    game.on('tradeOtherAdd', (items) => this.send({ op: 'tradeOther', items }));

    // SendTradeDone(0x22): 1 = exchange done, 0 = cancelled/failed.
    game.on('tradeEnd', (e) => this.send({ op: 'tradeEnd', reason: e.success ? 'done' : 'cancel' }));

    // Two-phase confirm markers (TradePressOwnOk 0x75 / TradePressOtherOk
    // 0x7c, both empty): logged only — not part of the frozen contract.
    game.on('tradePressOwnOk', () => this.log('trade: own confirm registered (waiting for partner)'));
    game.on('tradePressOtherOk', () => this.log('trade: partner confirmed'));

    // ------------------------------------------------- M13: private stores
    // PrivateStoreManageListSell(0x9a): own sell-store manage view. items =
    // current store contents (price + storePrice=referencePrice); sellables
    // (additive) = what can be listed.
    game.on('storeManageSell', (s) => {
      this.send({
        op: 'storeMsgSell',
        packageSale: s.packageSale,
        adena: s.adena,
        items: s.items,
        sellables: s.sellables,
      });
    });

    // PrivateStoreManageListBuy(0xb7): own buy-store manage view. items =
    // current store contents; buyables (additive) = owned reference items.
    game.on('storeManageBuy', (s) => {
      this.send({
        op: 'storeMsgBuy',
        adena: s.adena,
        items: s.items,
        buyables: s.buyables,
      });
    });

    // PrivateStoreMsgSell(0x9c)/MsgBuy(0xb9): title broadcast (store open)
    // or echo (storeTitle). Not a contract op by itself — cached and folded
    // into playerStore.title.
    game.on('storeTitle', (t) => {
      this.storeTitles.set(t.id, t.title || '');
    });

    // PrivateStoreListSell(0x9b)/ListBuy(0xb8): what an observer sees when
    // clicking a store (Player.onInteract). Cached per storeId so storeBuy /
    // storeSell can resolve prices and itemIds; title folded in from the
    // PrivateStoreMsg* broadcast seen at store open.
    game.on('storeListSell', (s) => {
      this.playerStores.set(s.storeId, { type: 'sell', items: s.items });
      this.send({
        op: 'playerStore',
        id: s.storeId,
        type: 'sell',
        title: this.storeTitles.get(s.storeId) || '',
        packageSale: s.packageSale,
        adena: s.adena,
        items: s.items,
      });
    });

    game.on('storeListBuy', (s) => {
      this.playerStores.set(s.storeId, { type: 'buy', items: s.items });
      this.send({
        op: 'playerStore',
        id: s.storeId,
        type: 'buy',
        title: this.storeTitles.get(s.storeId) || '',
        adena: s.adena,
        items: s.items,
      });
    });

    // NpcHtmlMessage (0x0f) — villager dialogs, .menu, teleporters, shops.
    game.on('html', (h) => {
      this.send({ op: 'npcHtml', html: h.html });
      this.log(`npcHtml (html window, ${h.html.length} chars, objectId ${h.objectId}) >>>${h.html.replace(/\s+/g, ' ')}<<<`);
    });

    // ------------------------------------------------------ M17: tutorial
    // TutorialShowHtml (0xa0): the new-char tutorial pages. Forwarded through
    // the EXISTING npcHtml op (the client dialog window already renders it),
    // with `action="link TE.."` rewritten to `action="bypass -h TE.."`: the
    // client dialog only makes bypass links clickable (npcdialog.js), and
    // the bypass op routes TE* back to RequestTutorialLinkHtml(0x7b).
    game.on('tutorialHtml', (html) => {
      const rewritten = html.replace(/action="link (TE\d*)"/g, 'action="bypass -h $1"');
      this.send({ op: 'npcHtml', html: rewritten });
      this.log(`npcHtml (tutorial, ${rewritten.length} chars) >>>${rewritten.replace(/\s+/g, ' ')}<<<`);
    });

    // TutorialCloseHtml (0xa3) — close the dialog window (new small op:
    // npcHtml has no close semantics).
    game.on('tutorialCloseHtml', () => this.send({ op: 'tutorialHtmlClose' }));

    // TutorialShowQuestionMark (0xa1) — blink the tutorial "?" icon (new
    // small op: no existing op carries it).
    game.on('tutorialQuestionMark', (markId) => this.send({ op: 'tutorialQuestionMark', markId }));

    // TutorialEnableClientEvent (0xa2) — server arms reporting of a client
    // UI event (answered with the tutorialEvent op -> 0x7e).
    game.on('tutorialEvent', (eventId) => this.send({ op: 'tutorialEvent', eventId }));

    // ActionFailed (0x25) — talk/action rejected.
    game.on('actionFailed', () => this.send({ op: 'actionFailed' }));

    // Action broadcasts (additive): social emotes, sit/stand, walk/run.
    game.on('socialAction', (s) => this.send({ op: 'socialAction', id: s.id, actionId: s.actionId }));
    game.on('changeWait', (c) => this.send({ op: 'changeWait', id: c.id, waitType: c.waitType }));
    game.on('changeMove', (c) => this.send({ op: 'changeMove', id: c.id, running: c.running }));
  }

  _sendPartySnapshot() {
    // Full snapshot: self first (from local state), then packet members,
    // leader flag per leaderId. Emitted on every composition change
    // (All/Add/Delete/DeleteAll); status flows via partyMemberStatus.
    const members = [];
    if (this.selfInfo && (this.party.members.size > 0 || this.party.leaderId === this.selfId)) {
      members.push({
        id: this.selfId,
        name: this.selfInfo.name,
        classId: this.selfInfo.classId,
        level: this.selfInfo.level,
        hp: this.self ? this.self.hp : 0,
        maxHp: this.self ? this.self.maxHp : 0,
        mp: this.self ? this.self.mp : 0,
        maxMp: this.self ? this.self.maxMp : 0,
        leader: this.party.leaderId === this.selfId,
      });
    }
    for (const m of this.party.members.values()) {
      members.push({
        id: m.id,
        name: m.name,
        classId: m.classId,
        level: m.level,
        hp: m.hp,
        maxHp: m.maxHp,
        mp: m.mp,
        maxMp: m.maxMp,
        leader: m.id === this.party.leaderId,
      });
    }
    this.send({ op: 'party', members });
  }

  // M14: clanInfo + clanMembers emitters. Before enterWorld they queue the
  // latest state (EnterWorld sends the clan packets before UserInfo — same
  // queue+flush pattern as skillList/itemList/questList).
  _sendClanInfo() {
    const c = this.clan;
    const info = c
      ? {
          op: 'clanInfo', id: c.id, name: c.name, leaderName: c.leaderName, level: c.level,
          ...(c.crestId ? { crestId: c.crestId } : {}),
          ...(c.allyId ? { allyId: c.allyId, allyName: c.allyName } : {}),
        }
      : { op: 'clanInfo', id: 0 }; // no clan (initial state or after leaving)
    if (!this.entered) { this.pendingClanInfo = info; return; }
    this.send(info);
  }

  _sendClanMembers() {
    const members = [...this.clanMembers.values()];
    if (!this.entered) { this.pendingClanMembers = members; return; }
    this.send({ op: 'clanMembers', members });
  }

  _shutdown() {
    if (this.closed) return;
    this.closed = true;
    if (this.game) {
      this.game.close();
      this.game = null;
    }
    try { this.ws.close(); } catch (_) { /* ignore */ }
  }
}

// M14: contract view of a decoded pledge member. id = the online objectId
// (0 when offline — the pledge packets never carry an offline member's id).
function pledgeMemberView(m) {
  return { id: m.onlineId, name: m.name, level: m.level, classId: m.classId, online: m.online };
}

// createChar field validation, mirroring aCis RequestCharacterCreate checks
// PLUS the sex clamp the server lacks. Returns the invalid_<field> reason or
// null when the request is safe to forward. race is not checked here — it is
// derived from classId by the caller.
function validateCreateChar(msg) {
  if (typeof msg.name !== 'string' || !CHAR_NAME_RE.test(msg.name)) return 'invalid_name';
  if (!Number.isInteger(msg.sex) || msg.sex < 0 || msg.sex > 1) return 'invalid_sex';
  if (!Number.isInteger(msg.classId) || !(msg.classId in BASE_CLASS_RACE)) return 'invalid_classId';
  const maxHair = msg.sex === 0 ? 4 : 6; // aCis: male 0..4, female 0..6
  const hairStyle = msg.hairStyle | 0;
  if (!Number.isInteger(hairStyle) || hairStyle < 0 || hairStyle > maxHair) return 'invalid_hairStyle';
  const hairColor = msg.hairColor | 0;
  if (!Number.isInteger(hairColor) || hairColor < 0 || hairColor > 3) return 'invalid_hairColor';
  const face = msg.face | 0;
  if (!Number.isInteger(face) || face < 0 || face > 2) return 'invalid_face';
  return null;
}

module.exports = { Bridge, deriveCredentials };
