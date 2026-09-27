# Quest completion playtest

## Configured-server completion and reconnect

On 2026-09-26 the existing PortAudit character continued Q1 Letters of Love
from its persisted stage2, without account creation, teleport, SQL edits,
inventory grants or progression overrides. Earlier acceptance at Darin and
the Roxxy letter exchange are recorded in `quest-data.md`.

| Ordinary interaction | Observed result in the private server receipt |
| --- | --- |
| Darin Quest link at20:52:54 UTC | Removed kerchief688, added receipt1079; progress `-2147483641` (stage3) |
| Baulro Quest link at20:54:45 | Removed receipt1079, added potion1080; progress `-2147483633` (stage4) |
| Darin Quest link at21:06:56 | Removed potion1080, added Necklace of Knowledge906×1; original packet reference `ItemSound.quest_finish`; progress0 |
| Fresh login at21:07:10 | Same character, reward906×1 retained; no688/1079/1080; Q1 retained with progress0 |

The reconnect also retained level5, EXP3470, SP80 and Adena320. This quest's
configured reward is an item; no experience or currency increase was observed.
The configured Java script and its deployed HTML/spawn copies were compared
separately. These observations prove this server flow and reconnect persistence,
not that an emulator reward or script is an official Interlude server rule.
Persistence across a game-server/database restart was not tested.

The final delivery was performed through the Elbera existing-character
protocol tool. A subsequent live browser login showed the Necklace of Knowledge
in Inventory and an empty accepted-quest journal with count0/25. Its level5
HUD remained visible. Screenshots are saved privately as
`tmp/restart-audit/quest-complete-journal.png` and `quest-complete-inventory.png`.
Browser journal/inventory checks are separate from the protocol delivery receipt.
The tool now retains actual MoveToPawn origins and transient quest sound/marker
events. Destinations are never promoted to arrival evidence, and pre-entry
feedback is not replayed. Raw dialogs, receipts and screenshots stay private.

The server keeps completed Q1 as a zero-progress QuestList row. The original
client emits no journal stage for that value; the browser now retires its
entry, count, selection and pending abort confirmation. This is distinct from
the original per-chapter completed badge.

The offline Elbera journal replay separately exercised the original resting
quest-marker icon, its click opening Q1's newest chapter, and a subsequent
zero-progress update removing that open entry. This marker test uses a clearly
labeled simulated packet, not a live server marker. A subsequent implementation
recovers the original discrete glow/blink timers and pointer art; its replay
was rechecked in the browser. GPU composition, the MainWnd tab container and
alternate SystemMsgWnd anchor remain unported.
The live browser emitted no captured errors; its one expected warning was the
unhandled PlaySound operation. Sound fields now survive the gateway and exact
stereo sources are exported, but the original radius/type-query inputs remain unresolved,
so no approximate quest playback was enabled. See
[the native PlaySound evidence](native-playsound-evidence.md).

## Navigation boundary observed during the return from Baulro

The local receipt `tmp/restart-audit/quest-completion-live.jsonl` records a
route accepted by the offline navigator at **2026-09-26 20:55:25 UTC**. Its
first leg starts at `(-84672, 245056, -3720)` and targets
`(-84928, 244928, -3720)`. The server subsequently reports a stopped position
of `(-84703, 245040, -3720)`. At 20:55:28 the harness refuses the next
arrival probe because it fails the geodata check from that actual position.
It does not treat the requested destination as evidence of arrival.

This difference reproduces without a server or account:

| Start of the same destination check | Result |
| --- | --- |
| Original departure `(-84672,245056,-3720)` | Passes 24 cell transitions at height `-3720` |
| Server stop `(-84703,245040,-3720)` | First transition fails |

The original line crosses west before north at this boundary. From the
reported stop, the first attempted transition instead goes north from cell
center `(-84696,245048)` to `(-84696,245032)`. The source cell's `-3720`
layer has **NSWE 7**, which forbids north. The target cell has only a
`-3232` layer; there is no ground layer at `-3720` there. The initial route
avoids this cell by going west first. The configured movement update below
reproduces the stopped coordinate and next rejected step. This is not evidence
that the geodata should be changed.

The receipt later records an operator-directed eastward recovery through
`(-84608,245056,-3720)` and a completed return to Darin at
`(-84436,242793,-3728)` at **21:01:15 UTC**. That demonstrates a successful
alternative in this run, not a general navigation fix. The harness retains
its explicit static-geodata/operational limits; this is not proof of native
browser movement parity.

### Configured Java update reproduction

`PlayerMove.updatePosition` computes the destination delta from the **rounded
current actor position**, adds the proportional displacement to separate
double-precision `_xAccurate/_yAccurate` accumulators, and rounds them with
`Math.round`. It then calls `GeoEngine.canMoveToTarget` for that short rounded
step before adopting the position. `CreatureMove.registerMoveTask` schedules
updates every 100ms; `PlayerStatus.getRealMoveSpeed` selects walking speed
for the first five updates. These are configured aCis behaviors, not proof
of original Interlude server rules.

The receipt's walk speed80 and movement multiplier1.100000023841858 give
float speed88. With the scheduled 100ms interval, independent Java arithmetic
and the installed server's actual block readers reproduce:

| Update | Rounded candidate XYZ | Short-step geodata check |
| --- | --- | --- |
| 1 | `(-84680,245052,-3720)` | Allowed |
| 2 | `(-84688,245048,-3720)` | Allowed |
| 3 | `(-84696,245044,-3720)` | Allowed |
| 4 | `(-84703,245040,-3720)` | Allowed; exact observed stop |
| 5 | `(-84711,245036,-3720)` | Rejected; actor remains at update4 |

The first server movement packet targets Z `-3697`, because
`MoveBackwardToLocation` adds collision height23 to the requested floor Z.
Ground updates normalize the destination through geodata. This explains the
packet's height difference; the failing transition is the rounded XY crossing.
The gateway preserves server-reported origins separately from destinations.

The exact live elapsed time of each tick was not recorded; the table is a
source-backed reproduction at the scheduled interval, not an asserted trace
of those unobserved internal timestamps. It nevertheless reproduces both
the observed stop and the next blocked cell without changing geodata. A
whole-line `canMove` result is not a guarantee that every rounded incremental
subsegment passes. Current route planning checks static lines; the harness's
arrival guard correctly detects the mismatch. No map or server rule was
changed. A future route change must account for rounded intermediate
steps without weakening the existing floor/NSWE checks.

[`tools/world/PlayerNavigationProbe.java`](../tools/world/PlayerNavigationProbe.java)
is the reusable Elbera Tools reproduction. It runs only a bounded translated
movement/traversal kernel and the installed `ABlock`/`MoveDirectionType`
classes. It never initializes `GeoEngine`, starts a server or opens an
account/database/network connection. The real `PlayerMove.updatePosition`
bytecode was inspected independently: offsets210..247 take the actor-coordinate
deltas, 314..337 select first-five-update speed, 419..478 accumulate/round,
and 557..592 reject a failed short step. The tool pins the relevant installed
class bytes and raw map input, so drift fails explicitly.

With JDK21 or newer on PATH, from the repository root:

```sh
java --class-path server/aCis_gameserver/build/dist/gameserver/libs/l2jserver.jar tools/world/PlayerNavigationProbe.java
node --test editor/world/test/geodata.test.mjs
```

All 20 geodata tests pass. The rounding regression uses explicitly synthetic
walls plus the translated Java sample positions to preserve the distinction
between a legal whole line and an illegal intermediate step. It does not
present synthetic map data as original evidence.

### Rockswell: narrow stairs missed by the coarse grid

A separate Q154 approach exposed a resolution gap. Rockswell's received
position was `(-78939,240305,-3443)`; the server stopped the player at
`(-78923,240470,-3488)`. The 128-unit search found no complete route from
there. A read-only 16-unit source-cell search found a stair route southwest
of the NPC, including these consecutive floor samples:

| Cell center XY | Configured source floor Z |
| --- | ---: |
| `(-79096,240520)` | `-3488` |
| `(-79096,240504)` | `-3472` |
| `(-79096,240488)` | `-3456` |

The browser planner now retains its coarse search first. If it cannot finish,
it tries a bounded fine search from the coarse partial route's endpoint, or
the actual start if no partial route exists. Fine search keeps `(x,y,z)`
states, source-cell cardinal transitions and every required turn. It uses
the same existing floor/NSWE checks, normalizes start/goal cell lookup to the
integer coordinates used by the line checker, and preserves the supplied XY
endpoints. Its 1024-unit local extent and existing time/expansion caps are
operational search limits, not game movement rules. If the bounded retry
fails, the original coarse result is retained.

For the recorded Rockswell start and exact NPC target, the runtime planner
returns **40 points / 39 segments**, ending at
`(-78939,240305,-3440)`, the source ground layer selected by the received
target's Z. All 39 segments independently pass the Java probe using installed
server block readers. This is static configured-geodata evidence, separate from the live
traversals recorded below. The complete coarse paths are
unchanged, so **this fallback does not fix the Baulro rounded-step hazard**.
The movement consumer must preserve the short turns rather than declaring
arrival within a radius larger than a 16-unit leg.

[`tools/world/inspect_navigation.mjs`](../tools/world/inspect_navigation.mjs)
reports both the actual coarse result and the current planner result. It
reads existing map files, records input hashes and sends no commands:

```sh
node tools/world/inspect_navigation.mjs '-78923,240470,-3488' '-78939,240305,-3443' > tmp/restart-audit/rockswell-navigation-inspection.json
node --input-type=module <<'JS'
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
const report = JSON.parse(fs.readFileSync('tmp/restart-audit/rockswell-navigation-inspection.json'));
if (!report.route?.complete) throw new Error('No complete route in this input');
console.log(execFileSync('java', ['--class-path',
  'server/aCis_gameserver/build/dist/gameserver/libs/l2jserver.jar',
  'tools/world/PlayerNavigationProbe.java', '--segments',
  ...report.route.points.map(p => `${p.x},${p.y},${p.z}`)], { encoding: 'utf8' }));
JS
```

The tests cover a synthetic narrow staircase, revisiting the same XY on a
different floor, a forbidden exit, positive/negative floating-point boundary
noise, retained coarse approach and bounded fine-tail work. No configured
geodata, original client geometry or server rule is modified.

### Offline reproduction

Run from the repository root with the owned converted `17_25` tile. This
reads existing files and invokes the production navigator without writing
assets or opening a game session. The hashes below are the inputs recorded
by this playtest; the assertions reject a different input silently replacing
the evidence.

```sh
node --input-type=module <<'JS'
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import { Geodata, NavGrid } from './editor/world/js/geodata.js';

const base = 'assets/world/17_25/';
const metadata = fs.readFileSync(base + 'geodata.json');
const meta = JSON.parse(metadata);
const binary = fs.readFileSync(base + meta.layers[0].data);
const sha = data => createHash('sha256').update(data).digest('hex');
assert.equal(sha(metadata), '2a5418a4743d3c4bd5b1f43428c369deaff110065ec985b221c8cabe6d7b526e');
assert.equal(sha(binary), '2c35446bb4c2a6e6ffa9afbe1a801b264e7ff9a32bcec9ae9809ee06ab000574');
const geo = new Geodata(meta, binary.buffer.slice(binary.byteOffset, binary.byteOffset + binary.byteLength));
const nav = new NavGrid(() => geo);
const target = { x: -84928, y: 244928, z: -3720 };
const initial = { x: -84672, y: 245056, z: -3720 };
const stopped = { x: -84703, y: 245040, z: -3720 };
assert.equal(nav._lineOk(initial, target), -3720);
assert.equal(nav._lineOk(stopped, target), null);
console.log({ initialResult: nav._lineOk(initial, target),
  stoppedResult: nav._lineOk(stopped, target),
  fromLayers: geo._layersAt(-84696, 245048),
  blockedNextLayers: geo._layersAt(-84696, 245032) });
JS
```

The relevant traversal is `NavGrid._lineOk` in
[`editor/world/js/geodata.js`](../editor/world/js/geodata.js); its cell-order
reference is the configured server's `GeoEngine.canMove` and
`getValidLocation`. The live receipt and converted map remain private.
No source map, server rule or geodata was modified for this assessment.

## Q154 hunt, narrow-route traversal and browser exchanges

The existing character accepted Sacrifice to the Sea at21:29:57 UTC on
2026-09-26, through Rockswell's actual received Quest and acceptance links.
The private receipt is `tmp/restart-audit/quest-hunt-live.jsonl`. A prior
coarse approach stopped below the platform. The first fine-path implementation
then completed all38points at21:29:13, reaching actual
`(-78939,240305,-3440)`; normal NPC HTML arrived at21:29:28. The reverse
route to `(-78912,240576,-3496)` completed at21:30:51. These were ordinary
server moves, with no teleports or geodata changes. The final planner's
40-point variant has the separate independent Java validation above.

Eight individual ordinary Power Strike uses against visible20481/20544
keltirs produced matching skillCast/skillLaunch and death events between
21:35:03 and21:39:22. Quest fur1032 increased through counts
1,2,4,5,7,8,9,10. At21:39:25 the server advanced Q154 to stage2
(`-2147483645`) and emitted a quest marker. The character reached level6,
EXP6559, SP160, Adena615, HP221, MP74 and CP88. Its received nine-row
skill list was unchanged, as expected for this configured class at level6.

These rates are configuration evidence, not official game rules: deployed
XP/SP are5× and quest drops3×. Q154's nominal40% drop uses the configured
DIVMOD rule, yielding one guaranteed fur plus20% chance of a second, capped
at10. Class0's next auto-learning checkpoint is level10, not6. AutoLearnSkills
remains True; no skill grants or progression overrides were used. The original
client quest records independently supply the10-fur requirement and chapter
text, not the emulator's drop/reward rules.

After a recorded walk to Cristel, the protocol session disconnected and the
real browser logged in. Its journal showed Ritual for Shilen complete and
Doll's Hair active, with the original instruction to deliver10furs. A normal
world double-click on Cristel and her rendered Quest link removed10furs and
added Fox Fur Yarn1033. The live quest marker opened the newly active
Completed Doll chapter. Reconnect at21:42:54 independently retained yarn1
and stage3 (`-2147483641`). Screenshots stay private as
`quest-hunt-stage2-browser.png` and `quest-hunt-cristel-browser.png`.

A subsequent recorded fine route into Rolfe's warehouse completed at
21:43:59 at`(-81840,243534,-3712)`. This provides a second traversal of a
location missed by the coarse grid. These recorded walks and live browser
exchanges are separate evidence; they are not represented as an entire
quest performed through browser navigation.

### Browser waypoint ownership

Fine routes now use a single in-flight raw waypoint. Only actual server
origins/position corrections at the exact XY and the checked floor advance
the route. Predicted character motion and packet destinations do not. A
same-destination order obtains an updated origin when ordinary arrival
emits no packet. The conservative supplied walking speed and100ms scheduling
allowance schedule a probe only; they do not certify arrival. This is
configured-server interoperability, not a decoded original navigation algorithm.

When the last actual origin is stale, one bounded ordinary move request
to the rounded rendered position first refreshes it. This can move the actor;
it is not a read-only position query. Matching uses destination XY, not a
protocol request ID. Only that reply's actual origin replans the route.
Missing coordinates, unsupported floors, timeout or failed refresh stop this
optional route without falling through to an unchecked straight shortcut.
New actions, self casts, sitting, death, teleport and session changes retire
it. Session reset also closes an old NPC dialog. Native movement prediction,
continuous pacing and the remaining coarse rounded-step failure are still gaps.

### Rolfe exchange and window lifecycle

The browser double-clicked the visible Rolfe and followed his received Quest
link. Chat reported Fox Fur Yarn removed and Maiden Doll1034 received. The
real quest marker opened Offerings for a Ritual, with the preceding three
chapters complete. A fresh session at21:52:36 retained the character state;
the private browser screenshot is `quest-hunt-rolfe-browser.png`.

This exposed two browser defects that are now fixed. An NPC dialog survived
disconnect and appeared beside a different NPC after reconnecting; session
reset now closes it. Its close button also lost clicks because two title-bar
drag handlers captured pointerdown. The close control now stops that bubbling
while capture-phase focus remains intact. Standalone and managed windows also
end dragging on cancellation or lost pointer capture. Actual Rolfe dialog
open→X close and open→Online off retirement both passed in the browser.
Nine pointer-sequence tests cover standalone/managed close, normal dragging,
child gestures and interrupted pointer capture.

The longer warehouse-to-lighthouse walk started at21:52:58 and reached the
stair approach. At21:54:29 it hit the tool's90-second command limit after
sending the next16-unit leg. Its last confirmed origin was
`(-79096,240456,-3448)`; the already sent order could still finish. This is
an incomplete walk, not a geodata wall or full-route pass. The operator
ended that session before reconnecting the browser.

### Final browser reward and reconnect

After reconnecting at the stair approach, a normal ground click moved the
browser character onto the lighthouse platform. Double-clicking visible
Rockswell opened his real HTML; following Quest removed Maiden Doll and
awarded Mystic's Earring113 plus300EXP. The journal visibly retired Q154,
returning to0/25. This verifies browser movement/dialog/reward presentation;
no per-waypoint browser trace was captured, so it does not independently
certify that this click used the fine follower. The movement endpoint and
camera framing also require further native picking/presentation comparison.

At21:56:31 a fresh independent login retained113×1,906×1,Adena615,
level6/EXP6859/SP160 and the same nine-row SkillList. Items1032/1033/1034
were absent; both Q1 and Q154 returned progress0. No server/database restart
was tested. The reward screenshot is private
`tmp/restart-audit/quest-hunt-reward-browser.png`. The inventory's accessible
contents included the earring, but its window still opened offscreen in the
623-pixel viewport; that pre-existing placement gap remains open.
