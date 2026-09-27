# Elbera Tools: existing-character playtest

A small interactive gateway client for recording ordinary play on an
**explicitly selected existing character**. It requires no browser, original
executable, SQL access or GM commands. It sends no character-creation
requests, does not seed progression and does not automate combat loops.
Only one mutation can run at a time; overlapping mutations are discarded,
not queued. A failed walk cannot release a previously submitted attack.

Private prerequisites: a running game stack/gateway, its installed `ws`
dependency under `gateway/`, the existing identity JSON, generated original
`assets/gamedata/actionname.json`, and local `assets/world/*/geodata.json`
plus their binaries for movement. Python and a browser are not required.
Optional `assets/gamedata/henna.json` enables read-only henna queries; missing
or invalid metadata refuses those queries without preventing ordinary play.
Optional `assets/gamedata/recipes.json` similarly enables recipe-detail queries;
recipe-book queries do not need this catalog.
Use a modern Node.js release supporting `node:util.parseArgs`.

## Run

Close the browser's Online session first. Do not log the same character in
concurrently. Supply an identity file containing the **already used**
`deviceId` string in a JSON object. The tool never generates an identity,
reads gateway logs for credentials or prints the identity. Preserve that
file outside tracked files.

```sh
node tools/playtest/play.mjs \
  --identity tmp/restart-audit/existing-identity.json \
  --character ExistingCharacterName \
  --receipt tmp/restart-audit/playtest.jsonl
```

The gateway defaults to `ws://127.0.0.1:8090`; `--gateway` selects another
explicit endpoint. `--timeout-seconds` defaults to 1200 and cannot exceed
3600. These are tool operating limits, not original game constants. World
entry has a 60-second deadline. The tool refuses missing/ambiguous character
names and sends `noAutoCreate:true`. **Protocol limit:** that flag prevents
gateway character creation; a login server configured to create unknown
accounts may still do so during authentication. Supplying the real existing
identity is required; this tool cannot verify account existence beforehand
without database access.

Nearby-object events can arrive before the character's world-entry packet.
The tool retains at most 2048 actual world events after selecting the
character and applies them in order only after the requested character's
identity matches. A mismatch or overflow stops the session and discards
that queue; no partial visible-world snapshot is silently accepted.

The receipt path is required and must be gitignored inside this repository.
The tool appends JSONL with a separate session ID per invocation and creates
the file with private permissions. Receipts contain actual game dialogs,
inventory, positions and events, so keep them private. Login/auth payloads
are excluded. A receipt cannot be the identity file or a symbolic link.

## Manual commands

Enter one JSON object per line and wait for `command-complete` or
`command-refused` before the next action. `status`, `visible` and `quit`
remain available while movement is pending. IDs below must come from the
actual server stream; they are examples of command structure, not fixtures
or invented game objects.

Completion records include the command's `op`. For actions other than
movement, `command-complete` means the request was sent, not that the server
accepted or finished it. Inspect the subsequent server events before the
next dependent action.

| Command | Meaning |
| --- | --- |
| `{"op":"status"}` | Latest server position, stats, complete SkillList, drops and latest dialog bypass indices |
| `{"op":"visible"}` | Current visible NPC objects, server-stated positions, distance and known death state |
| `{"op":"path","goal":{"x":0,"y":0,"z":0}}` | Inspect a NavGrid path without moving |
| `{"op":"walk","goal":{"x":0,"y":0,"z":0}}` | Follow a complete local-geodata path; `move` is an alias |
| `{"op":"talk","id":123}` | Gateway talk interaction with an actual visible NPC object; `npcId` is accepted only when uniquely visible |
| `{"op":"bypass","index":0}` | Send an indexed bypass from the latest actual HTML; arbitrary command strings are ignored |
| `{"op":"target","id":123}` | Normal Action on a visible NPC/drop; targeting a drop can pick it up |
| `{"op":"attack","id":123}` | One AttackRequest (force attack) to a visible live NPC; the server may approach/continue attacking |
| `{"op":"useSkill","skillId":3,"targetId":123}` | Use a currently granted, enabled, nonpassive skill; target optional |
| `{"op":"action","actionId":0}` | Send an ID present in the supplied original action catalog |
| `{"op":"hennaList","mode":"equip"}` | Request the install list; `unequip` requests the removal list, without changing symbols |
| `{"op":"hennaInfo","mode":"equip","symbolId":1}` | Request detail for an exact original-catalog symbol; `unequip` requests removal detail |
| `{"op":"recipeBook","bookType":0}` | Request recipe book type 0 or 1; no crafting or deletion |
| `{"op":"recipeInfo","index":1}` | Request detail using an exact `recipes.json` record's original `index` |
| `{"op":"quit"}` | Interrupt pending tool movement and disconnect |

Known action IDs are not a claim that every gateway action mapping is
complete. Server refusals remain in the receipt. This tool does not retry
attacks, buy items, change game rules or grant skills. End-of-input,
interrupt, socket closure and the overall deadline stop the session.
The gateway's `talk` sends normal Action interactions; against an attackable
mob this can initiate combat. It is not a separate harmless dialog opcode.

Henna commands send only list/detail requests. They do not install or remove
symbols, grant dyes, or change money/stats. Choose `symbolId` from the local
recovered henna catalog; unlike world object IDs, these are original static
metadata IDs. Unknown IDs and raw `hennaEquip`/`hennaUnequip` commands are
rejected. The list request's extra DWORD comes only from the catalog's
verified `native.listRequestExtraDword.byMode`, with no caller override or
invented zero. That value is the recovered caller return address at the
source DLL's preferred base, not a universal semantic game field; native
relocation remains a documented limit. The configured server ignores this
word. List/detail replies remain server-authoritative and may be absent or
empty when this character is ineligible or owns no dyes. Sending a query
does not establish eligibility or success. These queries use the same
one-command gate as actions, so wait for pending movement to finish first.

Recipe queries likewise only request book/detail data. Detail `index` must
match `assets/gamedata/recipes.json` → `records[].index`; it is **not** the
recipe item's ID, product ID, or the received book row's `index` ordinal.
The tool sends the admitted catalog index as gateway `recipeId`. Book type
must be the integer 0 or 1. Caller-provided IDs/fields cannot override this
mapping, and raw make/delete commands are unsupported. A catalog match does
not establish that this character has learned the recipe or can craft it;
the server may refuse or omit a detail reply. Queries never consume materials,
spend MP, register a recipe or manufacture an item.

## What the receipts prove

Movement uses the application's `Geodata`/`NavGrid` and logs hashes of every
loaded geodata pair. It refuses incomplete or planner-snapped routes, validates each sent leg
and arrival probe from the latest server floor, and stops on a stalled
position, death, missing speed/stance, timeout or iteration limit. A Move
packet's origin is recorded as an observed position; its destination is
never called proof of arrival. `walk-ended` reports the actual observed
position after exact XY arrival at every required waypoint. Short16-unit
turns are never skipped by a distance tolerance; the current floor is checked
before advancing. A failed walk followed by a
separately requested attack and server auto-approach is **not** a navigation
pass. There is no claim of exact native collision/pathfinding parity.

MoveToPawn likewise records its actor origin, never an arrival at its target.
Actual post-entry PlaySound and quest-marker events are retained in receipts;
pre-entry transient feedback is discarded. A recorded sound packet is not
proof of audible browser playback. The Q1 completion/reconnect and a failed
Baulro departure are documented in `docs/quest-completion-playtest.md`.

All five henna payloads (`hennaInfo`, equip/unequip list and detail) are
recorded unchanged after world entry. Only the `hennaInfo` state snapshot
can be retained during entry; pre-entry list/detail replies are discarded.
Closed sessions record none. `session-start.hennaCatalogSHA256` identifies
the optional local input without copying the original catalog into receipts.
Use the actual reply payloads for a private offline UI replay; a protocol
receipt does not prove browser rendering or native visual fidelity.

The recorder also preserves actual `recipeBook`, `recipeMakeInfo` and
`storageMaxCount` payloads. Only the capacity snapshot can be retained during
entry; pre-entry book/detail events are discarded. The optional catalog is
identified by `session-start.recipeCatalogSHA256`. No recipe data is synthesized
when the server sends an empty book or refuses a query.

For a progression check, record `status`, perform individual ordinary
fights against visible beginner mobs, and inspect each new server
`selfStatus` and `skillList`. Use a newly granted skill only after it appears
in that list; an outbound command alone does not prove a successful cast.
Require matching inbound `skillCast`/`skillLaunch` and relevant server
effects. Quit, reconnect using the same identity/character, and compare the
new server level/experience/SkillList. This tests configured-server behavior,
not whether that configuration equals official Interlude rules. Browser
rendering/UI must be verified separately.

Portable synthetic checks need no private files or network:

```sh
node --test tools/playtest/session.test.mjs
node tools/playtest/play.mjs --help
```
