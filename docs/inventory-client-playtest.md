# Inventory browser checkpoint — 26 September 2026

This is a bounded check of the existing PortAudit character on the local
configured aCis server. It is not certification of the whole inventory,
official server rules or a complete game client. Original client evidence is
in [inventory](native-inventory-evidence.md) and
[window placement](native-layout-evidence.md).

## Ordinary live actions

The browser right-clicked the Q154 reward, Mystic's Earring (113), and the Q1
reward, Necklace of Knowledge (906). Both equipped through ordinary UseItem
requests. The earring appears only in the left ear; the right ear remains
empty. UserInfo's object identities now distinguish the two accessory sides,
including two different objects of the same item template.

Right-clicking the existing Recipe: Bow (1788) opened the original recipe
warning in the original Warning window. Cancel left the recipe unconsumed.
Confirm and the positive-popup branch have controlled tests, but no live
recipe registration or positive-popup item was exercised. Recipe book,
manufacturing and complete crafting remain missing.

After disconnecting the browser, a fresh ordinary protocol login at
22:17:25 UTC retained both rewards equipped. The receipt has necklace in the
neck slot and the earring in the left-ear object slot, with right ear zero.
It also retained level6, EXP6859, SP160, Adena615, the same nine skills, and
completed Q1/Q154 state with no remaining quest items. M.Def was60 after
equipping (previously49); this is a server observation, not a newly inferred
stat formula. The protocol session quit before the next browser login.
No grant, database edit, account creation, teleport or server-rate change was
used. Server/database restart persistence was not tested.

## Placement and reconnect

At a temporary browser viewport of623×760, layout reset placed the256×401
inventory at(321,130), matching the recovered reset record and native integer
arithmetic for the browser root rectangle. Dragging it to(80,100), disconnecting,
reloading and reconnecting preserved that position and both equipped rewards.
The temporary viewport override was then removed.

The supplied WindowsInfo.ini position is now applied before saved browser
placement. Saved placement no longer gets overwritten by that INI value.
If no corner remains inside the root rectangle, Inventory uses its decoded
reset record. Partly offscreen placement with a corner inside is retained,
as the native saved-position predicate requires. Rechecking that predicate
on browser show/resize is a browser lifecycle adaptation, not the complete
native docking/resize algorithm. Inventory's inherited native parent still
needs proof. Other windows have not all migrated to this path.

The reset shortcut also opened chat during this check. That keyboard-dispatch
gap remains explicit; a correct coordinate result does not establish full
original shortcut behavior.

## Ordering and limits

An independent review reproduced a delayed snapshot overwriting a newer
inventory update while warning text loaded. Server item state now applies
synchronously in packet order; metadata only delays presentation. Session
checks suppress delayed window refreshes and loot messages after disconnect.
Pending item warnings retire on item removal or session reset and cannot
send a stale object's UseItem request.

The subsequent quantity checkpoint below adds shared dialog ownership and the
original destroy/crystallize branches. Full native drag/drop, two-handed slot
states, henna, exact text/input behavior, and missing equipment assets remain.
AutoLearnSkills remains True; preserving trainer behavior remains part of the
full port.

Private evidence stays under ignored `tmp/restart-audit/`:
`inventory-live.jsonl`, `inventory-original-recipe-warning.png`,
`inventory-equipped-narrow.png`, and `inventory-reconnect-narrow.png`.
Public Elbera Tools code and portable tests contain none of those receipts,
account credentials or original-derived game assets.

## Original quantity dialog checkpoint

Fresh original script/native checks now select Warning74 for single-item
destruction, NumberPad73 for ordinary stack destruction, and Warning336 for
crystallization. All9,238 item records preserve raw consumeType/crystallizable
fields; UserInfo preserves its raw crystallize capability byte. Unknown source
fields decline the action. Inventory and quest now share one DialogBox per UI
root; resetting one owner cannot dismiss the other's dialog.

The gateway no longer changes count0 into1. Selected counts pass unchanged to
the outgoing packet, with signed32-bit range validation. The original empty
quantity converts to zero; server acceptance of that request is a separate
question. Unsupported overflow is refused instead of inventing native wrapping
or clamping. The special AllItemCount branch is tested with source-shaped data,
but its complete native drag-modifier lifecycle is not implemented.

Elbera Tools `/test/inventory-dialogs.html` explicitly uses synthetic counts and
capability, with no game-server connection. Browser controls exercised:

- Dagger10/count1: original Warning, Confirm records count1.
- Adena57/count1234: original434×128 NumberPad; All displays1,234 and original
  English reading; Clear/Backspace/digit entry records count2. Empty Confirm
  records count0. Physical typing12345 displays12,345 in the source cyan color
  and the original magnitude reading.
- Scroll of Wisdom101: simulated capability1 admits Warning336 and Confirm
  records crystallize count1. Capability0 and quest origin do not open it.

These are actual UI replay results, not real item mutations. The browser drag
driver produced dragstart/dragend but no drop, even with the target visible and
uncovered. No actual completed HTML drag is claimed. The replay exposes these
events for further diagnosis; request-handler and stale-state tests are
independent of that unresolved interaction.

After refreshing the local gateway, the ordinary Online flow entered17_25.
Alt+V showed both equipped quest rewards, the existing recipe, dagger, ore,
tutorial item and615Adena. Crystallize was hidden for the existing Human Fighter.
Right-click Recipe: Bow reopened the original shared Warning; Cancel preserved
the item. The live world diagnostic loaded81source collision actors with27,044
triangles. No captured browser errors occurred in the live or replay tabs.
No item was destroyed, crystallized, or registered during this checkpoint.
The gateway restart did not restart the game server or database.

Private screenshots include `inventory-numberpad-all.png` and
`inventory-quantity-live-check.png` under `tmp/restart-audit/`. Native details,
input limitations and repeatable checks are in
[NumberPad evidence](native-numberpad-evidence.md). Full historical browser
battery and all inventory actions remain outside this bounded verification.
