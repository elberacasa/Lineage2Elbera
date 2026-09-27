# Original tutorial and quest-journal evidence

Verified on 2026-09-26 against the owner's Interlude client. This document
contains behavioral findings, addresses, and hashes; the retail binaries,
extracted scripts, UI art, and quest text stay in ignored local assets.
No emulator or another port supplies the rules below.

## Repeatable check

From the repository root, with the local client and Python `capstone` available:

```sh
python3 tools/ui/check_tutorial_quest_native.py --check
python3 tools/uscript/extract_uscript.py --check
node --test editor/world/test/tutorialwnd.test.mjs
node --test editor/world/test/camera-input.test.mjs
```

The native check pins both builds, derives the Engine decoding key from an
exported function-name sentinel, decodes only in memory, and checks original
instructions, command strings, virtual dispatch slots, and quest field order.
It prints provenance and recovered behavior, never an executable or asset dump.
Its checks are evidence for this exact client build, not a cross-edition claim.

| Original input | SHA-256 |
| --- | --- |
| `assets/interlude/system/engine.dll` | `07b24af4ab55e4230d0a7949df5b07565319e62a1b20f38fefb16ebe54821ad0` |
| `assets/interlude/system/NWindow.dll` | `af6c3437f3ccf1b26af8b066e0bbd791c7909c94bd3c7d9e3c68c5edcfe059a7` |
| `assets/interlude/system/Interface.u` | `5da491d8234863a94bfa1959bcb0be2cd5cdf81110003785436eecc04c86decd` |
| `assets/interlude/system/NWindow.u` | `6f3171147d83e447f2427e249c2ad73428e2b385d1557b86c53effa1062ea791` |

All addresses below are loaded virtual addresses: Engine base `0x10300000`,
NWindow base `0x10000000`. The protected Engine section is decoded by
subtracting `0x7965b551` from each aligned little-endian DWORD modulo 2^32.
The exported `UTerrainSector::IsTriangleAll` UTF-16 sentinel independently
derives and validates that key. Exported Engine functions often begin with
an E9 jump to their actual bodies. Import call placeholders are not a runnable
reconstruction of the original process; the verifier never executes the DLL.

## Tutorial windows and HTML

The extracted original classes are `Interface/TutorialBtnWnd.uc`,
`Interface/TutorialViewerWnd.uc`, and `Interface/SystemMsgWnd.uc` under
`assets/uscript/`. Bounded extraction recovers142 Interface source classes and87 NWindow source
classes. Four additional NWindow TextBuffers contain no class declaration;
the old extractor incorrectly scanned forward from them into later exports.
The corrected extractor preserves all previously recovered unique class text.

`TutorialBtnWnd` registers event 1510, reads the exact `QuestionID`, and shows
the effect button. `BeginEffect` forwards the ID to native code at
`0x100051e0`, which stores it at button offset `+0x34c`. The type-zero branch
of `NCEffectButton::OnLButtonUp` reads it at `0x1000670d` and forwards it
through `0x10144c10` to network virtual slot `0x1b8`. The original Engine
network vtable identifies that slot as `RequestTutorialQuestionMarkPressed`;
its body `0x10404e30` sends opcode `0x7d` and the unchanged integer ID.
Clicking hides the question button; it does not invent a question ID or open
an invented page.

`TutorialViewerWnd` registers events 2430 and 2440. It renders the received
`HtmlString`, focuses the separate viewer, or hides it. Original script
lines 24–42 clamp measured HTML height to 256–672, add 32+8 for the window,
use width−15 for HTML, and use height−32−9 for the HTML/middle background.
The xdat layout supplies the 310×401 initial window, HTML origin (8,32),
three original background textures, and the 32×32 question button with its
original resting, pressed, and highlighted textures.

`SystemMsgWnd.ChangeAnchorEffectButton` puts the question button's bottom-left
5 source pixels above and 5 pixels right of the active chat window's top-left.
This direction is confirmed by native `SetAnchor` argument storage
(`0x10114b91`, `0x10060790`) and position update (`0x1005c787`).

`WindowsInfo.ini` supplies the viewer's original initial position (714,0).
The browser clamps position to the viewport on show/resize so that a window
designed for the original desktop stays reachable in a smaller browser. This
is a browser presentation constraint; it does not change original dimensions.

The browser shares the existing NPC HTML parser and controls with an
independent `TutorialViewerWnd` registration. Tutorial `link <target>` actions
strip that prefix once and pass the remaining original target through the
dedicated tutorial link operation. Engine's `RequestTutorialLinkHtml` sends
opcode `0x7b` (`0x10404df6`); `RequestTutorialPassCmdToServer` separately sends
`0x7c` (`0x10404fe6`). The native question and client-event opcodes are `0x7d`
and `0x7e`. A tutorial link is not an NPC bypass.

The exact native effect-pulse painting/timing and viewer-title field binding
remain incomplete. The browser uses original static button art and leaves
an unproved title empty. It must not manufacture a pulse or reuse the NPC
dialog's title ID as if that were tutorial source data.

## Tutorial input events

Engine `UGameEngine::CheckTutorialClientEvent`, body `0x10488ae0`, forwards
its argument through console slot `0x158`. The original NWindow console
vtable maps this to `0x10144c20`. That function tests the argument against
its armed mask at `+0x50dc`, sends enabled events through network slot
`0x1bc`, then XOR-clears the reported bit. Console slot `0x150` maps to
`0x10144c50`, which replaces the mask with the newly received value.

Receiving an enable mask therefore does not report an action or complete a
tutorial. A qualifying action reports once while armed; a later mask can
rearm it. The browser `TutorialEvents` helper preserves this behavior and
only accepts single-bit action reports.

The following branches were recovered inside original `UInput::Exec`.
Each uses the global game engine's virtual slot `0x204`, independently
identified as `CheckTutorialClientEvent` by its exported vtable.

| Bit | Original input command | Dispatch instruction VA | Scope/condition |
| --- | --- | --- | --- |
| 1 | `PLAYERPAWNMOVETO` | `0x105af4ce` | Immediately after `UNetworkHandler::MTL` ground-movement dispatch at `0x105af4c2`; nonzero target location, Shift not held. Object-target/action branches bypass this report. |
| 2 | `CAMERAPITCH` | `0x105b4f3b` | Native rotation input branch: absolute integer angular delta must exceed 100. |
| 2 | `CAMERAYAW` | `0x105b50b5` | Same absolute delta condition. |
| 4 | `ZOOMINPRESS` | `0x105ae893` | Accepted zoom command's press branch. |
| 4 | `ZOOMOUTPRESS` | `0x105aea81` | Accepted zoom command's press branch. |
| 8 | `DEFAULTCAMERA` | `0x105acd1b` | Accepted default-camera command, including its original release/time guards. |
| 8 | `FIXEDDEFAULTCAMERA` | `0x105acfb8` | Accepted fixed-default-camera command. |
| 16 | `TURNBACK` | `0x105ad0b9` | Accepted turn-back command. |

The conversion helper at `0x107a66a0`, called at `0x105b4f01` and
`0x105b5073`, truncates the current command's requested angular delta toward
zero (`cvttsd2si` at `0x107a66b5`; the x87 fallback adjusts to the same result).
That integer is added to manual pitch/yaw and checked immediately; no sum of
previous commands participates in the threshold. The helper at `0x10533e00`
is signed integer absolute value; compares at `0x105b4f2c` and `0x105b50a2`
are strictly greater than 100. The pitch clamp follows the check. This is a
native angular delta, not a threshold of 100 browser pixels. A frame update,
an incidental target change, or receiving server state is not input evidence.
Other native controller/state guards are present; the table is not a claim
that every browser gesture implements the entire original camera controller.
No meaning has been assigned to other event bits, inventory opening, or
generic UI clicks.

The browser camera reports bit 2 only from its drag handler, converting the
existing requested radians to the original 65536-unit turn and applying that
per-command truncation/threshold. It reports bit 4 from nonzero wheel input,
including at the zoom limit, where the native accepted command still reports.
Camera sensitivities and movement are unchanged. Programmatic world-entry
resets and direct camera setters remain silent. There are currently no player
reset-camera or turn-back inputs, so their known bits 8/16 are not emitted.

## Quest flags become journal stages

Engine `UNetworkHandler::ShowQuestList` at `0x10433530` reads its socket's
quest map at `+0x5024`, passing each quest ID and server flag value to
`UGameEngine::AddQuestID` through virtual slot `0x43c`. That engine body at
`0x10489720` forwards through console slot `0x30c`. The NWindow console
vtable resolves the slot to `0x1016ac70`.

This original routine establishes the conversion:

1. If flag bit 31 is **clear**, the value is a sequential stage count N.
   The routine constructs bits 0 through N−1 (`0x1016ad4f`–`0x1016ad7c`).
2. If flag bit 31 is **set**, the supplied value is already a stage bitmask;
   it bypasses that conversion (`0x1016ad4b`–`0x1016ad4d`).
3. It examines only bits 0 through 29 in ascending order (`0x1016ad83`).
   Each set bit emits `Level = bit index + 1` (`0x1016adcf`).
4. Every emitted stage except the last has `Completed = 1`; the last has
   `Completed = 0` (`0x1016ae6e`–`0x1016aeb7`). Here `Completed` describes
   a journal stage, not whether the whole quest has been turned in.
5. Each row emits event 710 (`0x2c6` at `0x1016aecd`) with the original
   fields `QuestID`, `Level`, and `Completed`.

Examples: flags 3 produce stages 1 and 2 completed, stage 3 current.
Flags `0x80000005` produce stage 1 completed and stage 3 current; they do
not invent stage 2. Flags 0 produce no rows. Bit 30 is not a journal stage.
Taking only the highest bit loses the original stage history and treats
ordinary count values incorrectly.

## Native quest record layout and visibility

Engine `FL2GameData::QuestDataLoad` allocates 0xc8-byte records and invokes
the serializer through exported jump stub `0x1030487c`, body `0x104659c0`.
The serialization order below independently confirms the decoded questname
stream. Memory order differs from serialization order in two critical fields.

| Stream field | Native record offset | Representation |
| --- | --- | --- |
| tag, id, level | `0x00`, `0x04`, `0x08` | 32-bit integers |
| title, journal, description | `0x0c`, `0x18`, `0x28` | strings |
| itemIds, itemCounts | `0x34`, `0x40` | integer arrays |
| targetLoc | `0x50` | three floats |
| minLevel, maxLevel, questType | `0x5c`, `0x60`, `0x64` | 32-bit integers |
| targetName | `0x68` | string |
| getItemInQuest | `0x74` | 32-bit integer; semantic meaning unresolved |
| unknown1 | `0x24` | 32-bit integer; nonzero means journal is showable |
| unknown2 | `0x4c` | 32-bit integer; nonzero means item count is showable |
| startNpcId, startNpcLoc | `0x78`, `0x7c` | integer, three floats |
| requirements, intro | `0x88`, `0x94` | strings |
| classLimits, requiredItems | `0xa0`, `0xac` | integer arrays |
| clanPetQuest, requiredQuest, unknown3, areaId | `0xb8`, `0xbc`, `0xc0`, `0xc4` | 32-bit integers; not all semantic meanings recovered |

NWindow `UUIDATA_QUEST::execIsShowableJournalQuest` at `0x10126210` delegates
to `0x10143630`, which retrieves the requested quest/stage and tests its
`+0x24` field for nonzero (`0x10143690`). `execIsShowableItemNumQuest` at
`0x10126310` delegates to `0x101436e0` and tests `+0x4c` (`0x10143740`).
Both return false when no original record exists. The Engine serializer's
assignments at `0x10465a73` and `0x10465a7d` connect those exact offsets to
the parser's retained `unknown1` and `unknown2` values. Display aliases may
expose their meaning while preserving the raw fields and source provenance.

The original journal text, item lists, target locations, and requirements
still come from the decoded source records. Native flags decide which of
those records are current/history; they do not generate missing prose.
