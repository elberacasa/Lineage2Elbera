# Original inventory actions and paired accessories

Elbera Tools checks the owner's Interlude `Engine.dll`, `NWindow.dll`,
`Interface.u`, `NWindow.u` and item DATs without executing the native client. This closes
the inventory warning/quantity inputs and left/right accessory identity. It does not
certify all inventory behavior, item usability, server outcomes or UI parity.

## UseItem and warning precedence

Original `InventoryWnd.OnRClickItemWithHandle` and
`OnDBClickItemWithHandle` both call `UseItem`. After retrieving the actual
item, `UseItem` checks recipe first: message 798 and dialog 1111. Otherwise a
positive `PopMsgNum` selects that system message and dialog 2222. Otherwise it
sends `RequestUseItem(ServerID)`. Both warning branches reserve the object's
ServerID; `HandleDialogOK` sends it only for the matching dialog owner and
one of those two IDs. A template ID or an inventory row index is not the
request identity. This proof does not cover shortcut activation behavior.

The inputs are source fields, not item-name or icon classifications:

| Input | Original chain |
| --- | --- |
| Recipe | `EtcItemDataLoad` writes broad group 2 at `0x10468dd2`. Its named `etcitem_type` column goes to record+`0x100` at `0x10469021`; the native enum table contains `recipe=5`. NWindow's item constructor admits only group 2 and compares subtype 5 at `0x1002fa2f`, setting the initially zero Recipe flag. Other groups do not become recipes. |
| Popup | `ItemNameDataLoad` reads the literal `popup` and writes record+`0x64` at `0x1045fca2`. Named `GetItemPopMsgNum` reads the same field. NWindow copies it at `0x1002f86f` into control+`0x1ef4`, then emits `PopMsgNum`; the control-to-script item copy also preserves it. |

The binary serializers independently retain popup at record+`0x64` and the
etc table's final three DWORDs at +`0xfc`, +`0x100`, +`0x104` (ConsumeType,
subtype, grade). Existing DAT decoders are reread to exact EOF; the check
binds these relevant columns and consumers, not every item field or erased
native archive import.

Private `itemmeta.json` now carries `isRecipe` and `popMsgNum`. Recipe is a
boolean only when the group/subtype is known; popup retains the signed
integer, including zero and negative values. Missing source stays `null`.
The checked original tables contain 9,238 items, 939 recipe records and 28
positive popup records, with no missing warning inputs. These are source
coverage counts, not a claim that all those items are usable in the server.

## Destroy, crystallize and quantity input

The fresh original `InventoryWnd.OnDropItem` selects these branches. All
reserve the actual item's ServerID; `HandleDialogOK` requires `DialogIsMine`.

| Action and admission | Dialog | Message | Request count on OK |
| --- | --- | --- | --- |
| Destroy: ConsumeType in 1, 2, 3; ItemNum > 1; AllItemCount > 0 | Warning / 7777 | 74 | Reserved AllItemCount |
| Destroy: same stack predicate and quantity, ordinary drag | NumberPad / 8888 | 73 | `int(DialogGetString())`, unchanged |
| Destroy: remaining admitted item | Warning / 6666 | 74 | 1 |
| Crystallize: InventoryItem or EquipItem source; native player ability and item predicate both true | Warning / 9999 | 336 | 1 |

The outer trash drag gate admits InventoryItem, QuestItem, EquipItem and
PetInvenWnd. The narrower crystallize gate excludes quest/pet sources.
The original count dialog receives ItemNum as its parameter. Destroy does
**not** convert zero to one: that conversion belongs only to the separate
ground-drop quantity branch. Ground drop also captures the click location;
its dialogs/messages are 3333/400, 4444/71 and 5555/1833. This evidence does
not implement ground dropping or pet transfer.

`UICommonAPI.DialogShow` resolves the shared script named `DialogBox` and
passes `string(Self)` as owner. `DialogIsMine` compares that identity with
`DialogBox.GetTarget`. `ShowDialog` rejects a dialog already in use, then
stores the owner and marks itself in use. Separate uncoordinated dialogs
per inventory/quest window would not preserve this ownership contract.

The native predicates bind the runtime inputs without inferring from a
name, grade, class or skill:

- `UUIScript::execIsStackableItem` (`0x100f6a00`) accepts exactly ConsumeType
  1, 2 or 3. The original enum is normal=0, charge=1, stackable=2, asset=3.
  The control initializes ConsumeType to 0 (`0x1002ce8c`); only etc group 2
  copies record+`0xfc` (`0x1002f9fb`). Weapon and armor therefore use source
  zero. The historical DAT decoder's `stackable` field is this integer enum.
- `UIDATA_ITEM.IsCrystallizable` (`0x10123840`) looks up the ClassID and
  returns record+`0xcc`, zero for a missing record. The named source column
  is `crystallizable`; nonzero is the script boolean predicate.
- `UIDATA_PLAYER.HasCrystallizeAbility` (`0x10125f50`) tests local
  User+`0x2a8` for nonzero, returning false when there is no local User.
  The original UserInfo decoder supplies this field from byte field 129,
  checked against its actual reversed output-argument list. The browser
  must preserve that packet input; no recipe/skill/class inference is needed.

Private item metadata preserves `consumeType` and `crystallizable` as exact
source integers, with `null` for missing source. Fresh originals give 6,214
items with a stackable ConsumeType and 1,800 with nonzero crystallizable;
all 9,238 records have both inputs. These are client data counts, not
promises that the configured server permits an action on every item.

### AllItemCount is per-drag state

The native drag path first clears control+`0x1f0c` (AllItemCount). For
ItemNum > 1 it calls the named Windows `GetAsyncKeyState` import with
`0x12` and requires its sign bit (`0x1002ec23`–`0x1002ec3a`). This is Alt
(VK_MENU), with the high bit indicating the key is down. See Microsoft's
[virtual-key table](https://learn.microsoft.com/en-us/windows/win32/inputdev/virtual-key-codes)
and [GetAsyncKeyState contract](https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-getasynckeystate).

The selected count is control `Count`'s low DWORD (+`0x1e90`), initialized
to zero. Zero or a value above ItemNum selects ItemNum; otherwise the
existing Count is retained. The result is assigned to AllItemCount at
`0x1002ec5b` and copied to script ItemInfo+`0x128`. Ordinary unmodified
drag retains zero. Count's complete later write/drag lifecycle has **not**
been recovered, so this does not certify a complete Alt-all implementation
or justify treating every drag as all items. AllItemCount is not template
metadata and is not inferred from packet quantity.

After sending destroy or crystallize, the original script calls
`PlayConsoleSound(IFST_TRASH_BASKET)`. This establishes request-time script
ordering, not server-success feedback. The fresh `NWindow.u` enum gives this
member index 4. Native `execPlayConsoleSound` (`0x10100420`) passes it to the
table at `0x10350fa0`; entry 4 names `itemsound.trash_basket`. NWindow then
dispatches Engine slot +`0x63c`, the named `OnInterfacePlaySound` at
`0x104928f0`. The handler passes null actor, slot 0, zero position, pitch 1,
flags `0x10`, and the audio subsystem's `GetSoundVolume()` result. Radius
still comes from unresolved pointer `0x11d8dc10`. These exact inputs are
recorded; the driver branches and gain behavior for this interface path
have not been proven equivalent to browser playback. In particular, this
is a different flags/actor path from [packet quest audio](native-playsound-evidence.md)
and is not permission to invent a radius or reuse its assumptions.

## Left and right accessory slots

Original `IsLOrREar` and `IsLOrRFinger` are script functions. They obtain
four object identities from `GetAccessoryServerID`, compare the requested
ServerID to the left slot first (return −1), then right (return 1), otherwise
return 0. `EarItemUpdate` and `FingerItemUpdate` place the matching object in
that side only. A template's allowed slot mask cannot identify its side.

Native `UUIScript::execGetAccessoryServerID` (`0x100fc170`) retrieves the
local User through the named network `GetUser` vtable slot, then returns:

| Result | User field | UserInfo field index¹ | First paperdoll DWORD index |
| --- | --- | --- | --- |
| LEar | +`0xa0` | 27 | 2 |
| REar | +`0x9c` | 26 | 1 |
| LFinger | +`0xac` | 30 | 5 |
| RFinger | +`0xa8` | 29 | 4 |

¹ Zero-based fields in the original packet format; the string occupies two
native output arguments. The verifier follows the actual reversed push
list into these User destinations (`0x10434663`–`0x10434685`). This is the
first bank of object identities, distinct from the following template-ID
bank. It does not establish packet arrival ordering relative to ItemList.

## Reproduce

```sh
python3 tools/dat/build_meta.py --items-only
python3 tools/dat/build_meta.py --check-items
python3 tools/ui/check_inventory_native.py --check --output tmp/restart-audit/inventory-evidence.json
python3 -m unittest discover -s tools/ui -p test_inventory_native.py
```

The item-only operation writes only private `assets/gamedata/itemmeta.json`;
it does not rebuild skills, decoded source tables or icons. It rejects
duplicate item IDs and cross-group collisions rather than guessing which
record wins. The native check verifies 162 instruction anchors, pinned source
hashes, fresh original script function bodies and current exported action
fields. The receipt records source fingerprints and counts under ignored
`tmp/restart-audit/`; original assets and decoded source text remain private.
