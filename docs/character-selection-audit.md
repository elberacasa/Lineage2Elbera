# Character selection and ordinary Dwarf start

The browser now presents the existing character list for every nonempty
account, including a one-character account. Previously that account entered
its first character immediately, making the button for creating its second
character unreachable. Empty accounts still open the creator; explicit
`?cc=0` retains legacy first-character entry. This is a browser flow correction,
not proof of the original client's selection-screen layout or timing.

The selector and creator are retired with the online session. Deferred class
names cannot reopen an older selection list after another list or connection
has replaced it. Selecting a row sends only its received `slot`; opening the
creator does not create anything. Creation success waits for the refreshed
server list, from which the player explicitly selects the new character.

## Ordinary browser route

Keep the same browser origin, stored identity and gateway. Reconnect using
Online, click **Create new character** in `#charsel-overlay`, then use the
embedded `#charcreate-overlay iframe`:

1. Choose **Dwarf** in `#race-list`, and Male or Female in `#gender-list`.
2. The sole Dwarf class is **Dwarven Fighter** (`classId=53`, `race=4`).
3. Keep the available default hair style; choose a name in `#name-input`.
   This creator currently permits 1–16 ASCII letters. The configured gateway
   and server permit digits too; that mismatch is still open.
4. Click `#create-btn`. The embedded page sends the name, race, sex, class,
   hair style, hair color and face to its parent; only then does the parent
   request ordinary server creation. Errors are returned inline.
5. On the refreshed list, click the new `.charsel-row`. Existing characters
   remain on the account. No direct game-state modification is involved.

Opening `/create/` by itself is a preview and does not log in or create an
account character. The connected embedded route is required.

## Source and readiness boundaries

`editor/charcreate/app.js` is an authored showcase, not an original UI port.
`tools/dat/extract_charcreate.py` derives appearance references from original
`chargrp.dat` and `hairgrp.dat`, and descriptions from `classinfo-e.dat`.
Its class IDs and base stats are sourced from the configured aCis templates.
The existing recovered Interface/NWindow script set contains no matching
character-selection/creation implementation; no native behavior is inferred
from that absence. Native screen/control, preview camera, lighting and
appearance handling require their own evidence.

Both `dwarf_m` and `dwarf_f` glTFs and verified scale metadata are present.
The normal configured Dwarf spawn lies in `23_12`; that scene, geodata,
original terrain topology/edge sidecars and BSP assets are present locally.
This file check does not certify its rendered geometry or traversability.
The online loader selects the Dwarf model using the server race/class/sex,
but currently does not apply the character's selected hair/face variants.

The configured progression route is documented in
[native-recipe-evidence.md](native-recipe-evidence.md): Create Item at level5,
Spoil/Sweeper at10, then the local Wooden Arrow recipe/material route. The
browser forwards skills from the received SkillList and keeps the defeated
target selected, allowing an ordinary Sweeper request on that target. This
has not been verified live for a newly created Dwarf. In particular, the
gateway parses the corpse `sweepable` flag but currently drops it when
forwarding non-self deaths, so the client does not yet show that feedback.

Remaining creation limitations include no explicit Cancel button inside the
embedded creator and no in-world character-switch request; disconnect and
reconnect is the supported way back to selection. Network failure retires
the overlay so it cannot remain stuck above the world.

## Validation

`node --test editor/world/test/character-selection.test.mjs
editor/world/test/online-session.test.mjs` exercises actual main.js logic with
synthetic DOM/transport and controlled metadata completion. It covers the
one-character entry point, explicit slot selection, embedded Dwarf fields,
refreshed lists, legacy mode, stale work and session retirement. It performs
no browser automation, character creation or server mutation.

A separate ordinary browser check created a male Dwarf with the default
appearance through this embedded flow, selected it from the refreshed list,
and entered `23_12`. The original account's other character remained selectable.
Inventory showed the server's starter club, shirt and pants equipped, alongside
the unequipped dagger and tutorial guide. No grants or database edits were used.

That check exposed a late-model equipment loss, now corrected by replaying the
latest authoritative paperdoll after model adoption; see
[weapon-pipeline.md](weapon-pipeline.md#7-equipment-retained-across-player-model-loading).
Disconnect/reload/reconnect visibly retained the club on the Dwarf. A normal
Gremlin target followed by the received F1 Attack shortcut completed combat,
awarded 145 experience, 10 SP and 32 Adena, and advanced level1 to2 on the
configured server. These rewards establish this local interoperability run,
not official-server reward values or complete combat-animation parity. A second
disconnect/reload/reconnect showed level2 in the selection list before entry.

The region also loaded789 original static actors/149,497 placed collision
triangles. An ordinary structure click selected original StaticMeshActor120,
triangle267; see [native-picking-evidence.md](native-picking-evidence.md).
Higher-level Dwarf progression, Spoil/Sweeper, successful crafting and restart
persistence remain unverified. The captured run retained the known unsupported
`playSound` warning; no new model, layout or collision error was captured.
