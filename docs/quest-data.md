# Original Interlude quest journal

`tools/dat/export_quests.py` decrypts the local original
`assets/interlude/system/questname-e.dat` with the existing protocol-413
decoder and exports `assets/gamedata/quests.json`. The generated file is
ignored: original quest text remains a private build input/output.

Run `python3 tools/dat/export_quests.py`, then add `--check` to decrypt again
and compare the entire result. Run the decoder tests with
`python3 -m unittest discover -s tools/dat -p test_export_quests.py`.

The current original file yields 2,050 records for 342 quests, consuming
1,028,383 decoded bytes and the 13-byte SafePackage terminator. Every record
includes its decrypted byte offset, length and SHA-256. File provenance
includes encrypted and decrypted SHA-256 values and the edition. Duplicate
quest/stage keys, unexplained tails, malformed strings, truncated lists and
unequal item/count arrays fail extraction.

The external layout lead was the maintainer's
[L2ClientDat questname schema](https://github.com/majestic-world/L2ClientDat/blob/master/dist/data/structure/dats/questname.xml)
and its
[Interlude structure selection](https://github.com/majestic-world/L2ClientDat/blob/master/dist/data/structure/06_interlude.xml).
That schema was a decoding lead, not official behavior evidence. The original
Engine serializer at `0x104659c0` now independently verifies the complete
field order. Original NWindow code also proves stage-count/bitmask decoding
and the completion predicates: `unknown1 != 0` shows a completed journal
badge; `unknown2 != 0` shows completed item counts. See
[the native evidence and repeatable verifier](native-tutorial-quest-evidence.md).
The complete local binary parse validates record boundaries. Original recovered
`Interface.u` / `QuestTreeWnd` and `NWindow.u` / `UIDATA_QUEST` establish the
consumers for titles, journal names, descriptions, item IDs/counts, targets
and level restrictions. QuestTreeWnd explicitly treats negative item counts
as a signed quantity; the export preserves that signed interpretation.

The decoder retains unresolved flags under their field names and lists them
in provenance. It does not promote them into gameplay rules, completion
semantics, minimap behavior or requirements. The target/start positions are
raw decoded records, not yet proof of native target selection.

Three records (quest 422, stages 10/15/16) contain nonfinite start-NPC
coordinates in the original bytes. Their `startNpcLoc` is null and
`startNpcLocBits` retains all three original uint32 bit patterns. Finite
vectors also retain the bits. No substitute coordinate is supplied.

The browser now uses the original stage-count/bitmask distinction, sparse
history, current-stage text and the completion predicates. Item counts come
from current server inventory; prose and requirements come from the client.
The development replay at `/test/quest-journal.html` labels its simulated
progress explicitly and never connects to the game server.

Completed server records are distinct from completed journal chapters. The
configured server includes non-repeatable completed quests in `QuestList`,
but `exitQuest(false)` clears their condition, so their flags become zero.
Original NWindow `AddQuestID` (`0x1016ac70`) emits no stage event for zero;
`QuestTreeWnd.HandleQuestList` creates and counts quests only from those events.
The browser therefore excludes rows with no emitted stages from its journal
and displayed count, while preserving the received server snapshot. Retired
selections/expansions are cleared, and an outstanding abort confirmation for a
retired selection is cancelled. The existing Elbera source verifier covers the
stage decoding; `editor/world/test/quest-confirmation.test.mjs` exercises
active-to-zero completion, reserved-bit-only records, pending confirmations,
and a later reappearance of the same quest ID without a live server.

The abort path now uses original DialogBox Warning182 or Notice1201, original
artwork, labels and source rectangles. A captured selection/session is checked
before opening and after confirming; reconnect cannot apply a stale request.
Cancel and the no-selection notice were exercised in the live browser without
abandoning the audit character's active quest. The development replay also
exercised Confirm without sending any game-server request.

The local audit character accepted quest1 at Darin and advanced to stage2 at
Roxxy through actual server interactions, exchanging item687 for item688.
The browser then displayed that persisted journal history and source prose.
The continuation completed all remaining exchanges with Darin and Baulro,
received Necklace of Knowledge906, and retained the reward and zero-progress
completion across reconnect. The live browser displayed that inventory reward
and an empty0/25 journal. See [the playtest and navigation limits](quest-completion-playtest.md).
The original quest-update marker now opens the requested quest's latest chapter;
its source art, packet/event chain, ChatWnd anchor, discrete glow/blink timers
and pointer artwork are covered by
[native evidence and a labeled replay](native-quest-marker-evidence.md).
Target guidance, native TreeCtrl line breaking, exact dialog keyboard/button
states, marker GPU composition and the enclosing MainWnd tab remain unfinished.
Recovering the journal and observing rewards do not establish that the
emulator's quest scripts or rewards are official.
