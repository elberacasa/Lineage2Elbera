# Original skill-training messages and layout

Elbera Tools inspection:

```sh
PYTHONDONTWRITEBYTECODE=1 python3 tools/ui/mine_skilltraining.py --emit
PYTHONDONTWRITEBYTECODE=1 python3 tools/ui/mine_skilltraining.py --check
```

This rereads the owner's pinned originals, decodes Engine only in memory,
checks native instructions and exports only ignored
`assets/gamedata/skilltraining.json`. It never rewrites the full UI catalog.
The export includes two windows, 50 controls, original text IDs, system
strings, artwork references and raw anchor rules. It explicitly sets
`geometry.resolvedPixels=false`: source rules are available, but inherited
frame settings, intrinsic text sizes and named-anchor aliases still need
runtime verification. No public client assets are included with the tool.

## Native protocol, independently of server implementations

Engine SHA256:
`07b24af4ab55e4230d0a7949df5b07565319e62a1b20f38fefb16ebe54821ad0`.
NWindow SHA256:
`af6c3437f3ccf1b26af8b066e0bbd791c7909c94bd3c7d9e3c68c5edcfe059a7`.
The existing native inspection helper documents/reuses Engine's additive
section recovery. Addresses below are virtual addresses (Engine base
`0x10300000`, NWindow base `0x10000000`). Packed Engine import calls were
erased, so this is static data/control-flow proof, not execution evidence.

The dispatcher at `0x10421cfe` reads the opcode byte, multiplies by `0x104`
and loads the handler at `0x10a57310 + opcode*0x104`. Original registrations
at `0x1083796f`, `0x1083798c`, `0x108379e3` establish the following table.
All body fields below are four-byte little-endian integers.

| Message | Opcode | Original handler | Payload |
| --- | --- | --- | --- |
| AcquireSkillList | `0x8a` | `0x10415f30` | type, count; count rows of id, level, maxLevel, spConsume, itemConsume |
| AcquireSkillInfo | `0x8b` | `0x10416160` | id, level, spConsume, type, count; count rows of raw1, itemId, count, raw4 |
| AcquireSkillDone | `0x8e` | `0x10400b70` | No payload consumed |
| RequestAcquireSkillInfo | `0x6b` | `0x10407a70` | id, level, type |
| RequestAcquireSkill | `0x6c` | `0x10407ae0` | id, level, type |

The receive format strings are `dd`, `ddddd`, `dddd`, and `d`; the two
requests use `cddd`, with the `c` being their opcode. The list rows pass to
NWindow `0x1016bea0`: original parameter names identify the third field as
`iMaxLevel` (`0x1028784c`) and fifth as `bItemConsume` (`0x10287818`). These
names are not inferred from a repeated level or a server variable. The
original list script only uses ID/level/name/icon/SP cost for its row UI.

The requirement consumer `0x1016c400` forwards all four integers to
`NConsoleWnd::GetNCItemInfo` (`0x10157350`). The second drives the original
item lookup; the third supplies `iNumOfItem`. The first and fourth are copied
into the native item-info structure but their names are not established by
this checkpoint. Preserve them as raw fields. The original info script has
one requirement icon/name slot and each received requirement updates that
slot; a multi-row requirement list would be a product change.

Completion forwards through GameEngine slot `+0x4e8`, body `0x1048ab60`,
to NWindow console slot `+0x38c`, `HideTrainWnd` at `0x10157650`. It emits
**both** event 2050 (detail hide) and 2020 (list hide). It does not itself
prove successful learning or grant skills locally; subsequent authoritative
state messages determine learned skills and remaining SP/items.

## Original layout and script scope

Both source root rectangles are **256 × 401**, with CenterCenter anchors.
List tree: source 238 × 273 at raw offsets 9,49. Detail buttons: 76 × 23,
offsets 51,372 and 131,372, IDs 368 and 369. The two SP value controls use
offsets 140,345; their captions anchor to the left edge of that named value
control using self TopRight and offset -20,0. These are native rules, not a
recommendation to drop anchor semantics and position only by raw offsets.

`SubWndNormal` (record byte 505030) and `SubWndEnchant` (501300) declare
SkillTrainInfoWnd in the Window-specific parent field. The shared native
parent proof and corrected decoder are documented in
[native-layout-evidence.md](native-layout-evidence.md). The original script
switches these two subwindows and sends normal/fishing/clan requests with
types 0/1/2; enchant uses distinct requests and remains outside this protocol
checkpoint. Back hides detail and shows the existing list. Learning waits
for server messages; the script does not immediately hide on click.

Native absolute dimensions store directly into the total rectangle. The
original `NCFrameWnd::OnPaint` at `0x1001eb60` clips to those same dimensions
(`0x1001ebe8–0x1001ec0d`). Its enabled top-frame/normal-size branch draws
the background at Y20 with height `sourceHeight−20`
(`0x1001ec30`, `0x1001ec75–0x1001ecb0`), without increasing the outer size.
`GetClientRect` at `0x1005d0a0` subtracts parent X/Y but copies width/height
unchanged. Adding a titlebar outside the source height is unsupported.
Which inherited frame branch applies to each window still requires source
default/inheritance tracing before claiming complete visual parity.

The native TextBox autosize flag is also essential. For example txtMPString
declares width245 but autosize1: native text refresh replaces its anchor
rectangle with measured width+1 and measured height. The narrow export now
includes each control's `textLayout.autoSize` (-1 means inheritance),
`defaultText` (including colons), alignment enum and font enum. Native font
measurement must be matched; arbitrary CSS shrinking is not this rule.
All 37 trainer TextBoxes pass an explicit decoder-completeness guard. Five
have inherited autosize -1: description and requirement-name in each
subwindow, and the list heading. Their prototype resolution is still listed
as unresolved metadata. Native active anchors override the right-alignment
move during autosize; both SP values retain their X140 anchor, then resize.

## Original tree row flow

`NCXMLTreeCtrl::InsertNodeItem` (`0x1006b560`) copies script offsetX/offsetY
to native item `+4/+8` and the script bLineBreak bit to `+0xc`. Item type1
is text and type2 is texture. `NCXMLTree::DrawTreeNode` (`0x1006ca90`)
maintains a cursor and maximum height for the current line:

```text
nodeOrigin = passedOrigin + nodeOffsets
x = nodeOrigin.x; y = nodeOrigin.y; lineHeight = 0; totalHeight = 0
for each nonblank item:
    if bLineBreak:
        x = nodeOrigin.x + offsetX
        y += lineHeight; totalHeight += lineHeight; lineHeight = 0
    else:
        x += offsetX
    draw at (x, y + offsetY)
    x += itemWidth
    lineHeight = max(lineHeight, itemHeight + offsetY)
totalHeight += lineHeight
```

The break branch is `0x1006ced3–0x1006cf09`; texture advancement and max
height are `0x1006d0c3–0x1006d0e1`; text measurement/advancement is
`0x1006d049–0x1006d06b`. Normal text can wrap at remaining tree width minus
5 (double constant `0x10232588`); `t_bDrawOneLine` takes the unwrapped
branch. Text extents come from the native measurement function, while
texture extents come directly from script dimensions. Child nodes stack by
the returned accumulated height; no fixed generic row height is proved.

The trainer's three source texture items therefore draw at relative X
0,1,1; the following name starts at X36. Their first-line height is at least
39, from the 35-high outline at offsetY4. The level and cost break items use
relative X37 and X77, and draw at the accumulated line Y minus14. They only
leave the row at height39 when measured text/wrapping does not increase the
line maxima. The native expanded-background height38 is an independent
source drawing parameter; it must not be substituted for layout height.
The tool checks 22 native flow instructions and exports `nativeTreeFlow`.

The narrow browser renderer now consumes these source anchors, text sizing
flags and tree cursor rules, with an opt-in 256 × 401 total window rectangle.
It remains a bounded adaptation: native font measurement/wrapping, inherited
flags, full frame chrome, button state artwork, scrollbars/selection painting
and general named-anchor lookup are not yet proved visually identical.
The root center must truncate viewport and source anchor points separately;
truncating their combined difference can shift an odd-sized rectangle by one.

Source script hashes are pinned in the tool, and the narrow export records
every input hash. No authored replacement captions or gameplay costs are
introduced. Full interface regeneration is deliberately deferred until
consumers handle recursive parents and explicitly unresolved duplicate names.

## Clan reputation used by the trainer

The original trainer scripts call `GetClanNameValue(playerClanId)` for clan
mode. This is reputation, separate from the character's SP. Elbera Tools
can reproduce the native packet evidence without a game server or account:

```sh
PYTHONDONTWRITEBYTECODE=1 python3 tools/ui/check_clan_native.py --check
node --test gateway/test/clan-reputation.test.js
```

The verifier pins the same Engine/NWindow hashes above. Original opcode
registrations at Engine `0x1083731f` and `0x10837935` select handlers
`0x10438df0` (full clan list, 0x53) and `0x10439280` (info update, 0x88).
The full packet reads `dddSS`, then `dddddddddSdd`; its sixth integer after
the strings goes to `PledgeInfo+0x74`. The update's `ddddddddddSdd` reads its
seventh integer into the same field: byte 25 when counting the opcode.
The tool tracks the original stack-address pushes to compute those offsets.
The update call passes one extra local pointer beyond its format string;
that unused argument is not an extra wire field.

NWindow's update consumer labels `+0x74` as **ClanNameValue** at
`0x1015afae–0x1015afc0`, using the literal at `0x10283e1c`.
`UUIScript::execGetClanNameValue` (`0x100fc5c0`) looks up the requested clan
and returns that same field at `0x100fc655`. Its original script declaration
returns signed `int`. The local aCis packet writers agree with these offsets;
their source is a compatibility comparison, not the official proof.

The gateway preserves this signed value in both full and updated `clanInfo`
snapshots. Updates must match the current clan ID; subpledge packets remain
outside the current contract. The trainer reads the latest snapshot when its
window is shown, following the source script; unrelated updates do not rebuild
the open skill tree or reset its scroll position. The snapshot clears on
leave/session reset. Unknown values
remain absent. Synthetic tests cover negative/zero values, following member
and alliance fields, unrelated clans, login queuing, separate sessions,
leaving and truncated packets. This does not implement clan subpledges,
permissions or their remaining interface behavior.

## Live browser checkpoint

On 26 September 2026, the existing level-2 audit character reached Talking
Island's fisherman Klufe through ordinary server movement. The approach used
the separate protocol journey harness; it is not a browser-navigation proof.
After reconnecting Online, actual browser NPC selection/conversation opened
the fishing trainer through the returned HTML link. The source window showed
Fishing, Pumping, Reeling and Fishing Expertise at level 1, in server order.

Selecting Fishing opened its exact original description and MP cost 1, with
server requirements of SP 0 and Adena 1,000. The character had 41 Adena. Learn
produced the server's insufficient-Adena/prerequisite messages and a fresh
acquisition list; the browser followed that list instead of granting a skill.
Reopening details and using List returned to the same four entries. No browser
errors or warnings were observed. The private screenshot is
`tmp/restart-audit/trainer-live-fishing.png`.

The replay tool separately exercised Learn without an answering server, where
the details remain open, plus completion/session reset. That result must not
be confused with a live server's subsequent list/done response. Successful
learning, reconnect persistence, clan learning and enchantment remain open.

The local source and built server configuration both already have
`AutoLearnSkills = True`. `PlayerStatus.addLevel` calls `Player.giveSkills`,
which calls `rewardSkills` under that setting and sends the ordinary
`SkillList`. The browser's learned-skill update path is separate from trainer
acquisition windows. Auto-learn is server policy, not an invented browser
progression rule or an original-client numeric claim. Its actual level-up,
new skill use and reconnect persistence still need a live acceptance scenario.
