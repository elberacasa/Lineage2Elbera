# Elbera Tools: original Interlude henna evidence

This check binds the supplied original client's henna catalog fields, inventory
rows, packet events and ordinary list/detail requests. It reads original files
and disassembles decoded bytes in memory; it executes no native code and opens
no game connection. Source extraction does not certify browser pixel parity or
server game rules.

## Reproduce

```sh
python3 tools/ui/check_henna_native.py --check --output tmp/restart-audit/henna-native.json
```

The checker requires the local original files, the existing package decoder and
Capstone. The optional receipt is private. `verify()` returns the field mapping,
89 exact class-step entries, event IDs, byte interpretation, numeric colors and
the bounded list-request words used by `mine_henna.py`. The miner independently
decodes `hennagrp-e.dat` and XDAT; generated metadata is not the native check's
oracle. No original script text or asset contents are included in this document.

| Original input | SHA-256 |
|---|---|
| `Engine.dll` | `07b24af4ab55e4230d0a7949df5b07565319e62a1b20f38fefb16ebe54821ad0` |
| `NWindow.dll` | `af6c3437f3ccf1b26af8b066e0bbd791c7909c94bd3c7d9e3c68c5edcfe059a7` |
| `Interface.u` | `5da491d8234863a94bfa1959bcb0be2cd5cdf81110003785436eecc04c86decd` |
| `NWindow.u` | `6f3171147d83e447f2427e249c2ad73428e2b385d1557b86c53effa1062ea791` |

Addresses below are preferred virtual addresses: Engine base `0x10300000`,
NWindow base `0x10000000`. The checker also pins the recovered scripts by hash.

## Catalog fields and visible identities

`FL2GameData::HennaDataLoad` at `0x10472b50` names `Hennagrp` and calls the
serializer at `0x10446db0`: two DWORDs followed by four strings. The native
consumers establish their meanings, independently of English text similarity.

| Serialized field | Native offset | Meaning and consumer |
|---|---|---|
| 0 | `+0x00` | Symbol ID |
| 1 | `+0x04` | Dye item ID |
| 2 | `+0x08` | Symbol name, `UIDATA_HENNA.GetItemName` |
| 3 | `+0x14` | Symbol icon, `UIDATA_HENNA.GetIconTex` |
| 4 | `+0x20` | Inventory description, `UIDATA_HENNA.GetDescription` |
| 5 | `+0x2c` | Detail `TattooAddName`; remove-list description |

The UIDATA getters read the same symbol-ID table at `FL2GameData+0x6a8d0`
(`0x10121f51`, `0x101220d1`, `0x10122251`). Detail field selection is visible
at `0x10158fbd..0x10159078`; removal uses `+0x2c` at `0x101596c5`.

Equip-list rows use **dye item metadata**, through the named `GetItemData`
import at `0x10158af4`: item name `+0x50`, description `+0x54`, icon `+0x3c`.
Remove-list rows use **symbol metadata**, through `GetHennaData` at
`0x10159694`: name `+8`, description `+0x2c`, icon `+0x14`. Detail shows both
identities. A symbol icon must not silently replace the dye icon in an equip
row. `symbolname-e.dat` concerns chat symbols and is not this catalog.

## Inventory row count and activity

Original `InventoryWnd.UpdateHennaInfo` calls
`GetClassStep(PlayerInfo.nSubClass)`. Native `execGetClassStep` calls
`0x10146260`, whose byte dispatch table at `0x10146350` covers IDs `0..57`.
IDs `88..118` return 3; other IDs return -1. The exported `classSteps` retains
every covered ID rather than recreating a level or profession-name heuristic.

The script sets 1, 2 or 3 rows for those results, otherwise zero; it then displays
at most that many cached symbols in packet order. For example, class ID 0
produces one row. This UI rule is independent of a server's reported maximum
usable slots. A symbol is disabled when the second cached row DWORD is zero.
`HennaAPI.GetHennaInfo` returns both original DWORDs unchanged.

`ReceiveHennaInfo` resets the cache before event 260; each subsequent
`AddHennaInfo` appends a row and emits event 2630. A zero-symbol packet therefore
clears old symbols. The script's `bDisabled` choice is proven; its precise icon
tint/overlay and NCItemWnd icon inset remain outside this check.

## Incoming packets and UI transitions

The checker follows the original opcode dispatch table, named UGameEngine
receiver, NConsole vtable and event emitter.

| Opcode | Native events | Payload shape |
|---|---|---|
| `E2` | 1640 list reset; 1650 per row | `ddd`, then `ddddd` rows |
| `E3` | 1660 equip detail | six DWORDs, then six DWORD/byte pairs |
| `E4` | 260 inventory reset; 2630 per symbol | six bytes, two DWORDs, then two-DWORD rows |
| `E5` | 1670 list reset; 1680 per row | `ddd`, then `ddddd` rows |
| `E6` | 1690 remove detail | six DWORDs, then six DWORD/byte pairs |

For E4, `0x104195b3..0x104195e5` explicitly sign-extends the six stat bytes.
For E3/E6, the decoder first zeroes all seventeen DWORD destinations, then the
generic `c` decoder writes only one byte (`0x10402713..0x10402715`). Their
after-stat values are consequently **unsigned 0..255**. These detail values
are displayed as supplied, not calculated by adding the inventory deltas.
Keep raw bytes in transport so each consumer can apply the proven interpretation.

Original HennaListWnd uses mode 1 for equip and mode 2 for removal. A selected
row requests that mode's detail by symbol ID. Detail arrival hides the list and
shows/focuses HennaInfoWnd. Its Prev button requests the corresponding list;
its OK button requests equip/removal using the stored symbol ID, then the
detail window hides. The script does not add another generic confirmation
dialog or derive a new eligibility rule from the unknown detail field.

## Outgoing requests and the unusual list DWORD

The named native request methods use opcodes `BA..BF` with format `cd`.
`BB`, `BC`, `BE` and `BF` explicitly pass the symbol-ID argument. The two list
methods take no argument but still use that format. They do **not** explicitly
push a default zero.

The ordinary UIScript calls at `0x10102728` and `0x101029a8` return to
`0x1010272a` and `0x101029aa`. NConsole tail-jumps to the list methods via
`+0x3cc/+0x3d0`, leaving that return address on the stack. The methods push only
opcode, format and socket before calling its `+0x68` sender. The sending socket
at `0x104029b0` passes the first vararg to serializer `0x104021f0`. Its `c` and
`d` branches each advance the vararg pointer by four bytes: `c` reads the opcode;
`d` reads the original caller return address. The alternate socket's same
virtual slot is a no-op, not a different list-value implementation.

The exported `listRequestExtraDword` therefore records:

| Mode | Preferred-base word | NWindow relative offset |
|---|---|---|
| equip | `0x1010272a` | `0x0010272a` |
| unequip | `0x101029aa` | `0x001029aa` |

These are caller words exposed by a missing vararg, **not semantic game fields**.
The original PE does not set DYNAMIC_BASE but has a base-relocation directory.
The actual native load address has not been observed: relocation would change
the encoded word. A browser using these pinned preferred-base words preserves
this source-build example; it cannot claim universal byte-for-byte parity with
all callers or loaded addresses.

For interoperability only, installed aCis `RequestHennaItemList.java` and
`RequestHennaUnequipList.java` read the DWORD into an unused field; their run
methods request the player's respective lists without consulting it. This
server behavior does not establish the original field's meaning.

## Fee color and remaining scope

Original HennaListWnd formats the fee, then calls `GetNumericColor`.
`execGetNumericColor` at `0x101003a0` calls `0x10063020`, using the named Core
`appStrlen` import. It counts UTF-16 code units excluding commas. Below five
units the color is ARGB `FFDCDCDC`; otherwise `(length-2)%4` selects
`FFFF80FF`, `FFFFFF00`, `FF00FF00`, `FF00FFFF`. This directly binds the script
API to the same color cycle documented for the
[original NumberPad](native-numberpad-evidence.md); it is not a fee-size guess.

Henna's money tooltip calls `ConvertNumToText`, while NumberPad uses
`ConvertNumToTextNoAdena`. The exported wrappers pass flags 0 and 1 respectively
to the same helper at `0x100676e0`. For a nonempty magnitude reading, flag 0
appends one literal space and the original system string at GameData `+0x6bed8`
(`0x10067caa..0x10067cd2`). `SysStringLoad` stores its array at `+0x6a8dc`
with twelve-byte entries (`0x10455553..0x10455560`), binding that suffix to
system string 469. The script's `GetSystemString(469)` label and this native
suffix therefore share original data.

The cached path (`0x10067808..0x10067860`) applies the same nonempty/flag test.
The normal path caches the unsuffixed reading before adding the suffix.
Null/empty input, exact zero and the over-twelve-character literal comma-grouping
early return bypass it. In the bounded English ASCII-digit domain, the browser
can reuse NumberPad's verified reading and append the source suffix only to a
nonempty result with at most twelve input digits. Preserve all existing label
and trailing whitespace; do not trim before adding the extra space. This
`numericText` contract proves text content, not native tooltip geometry or font.

Prices, required dye quantities, eligibility and stat changes remain supplied
by the server. The source check establishes data and control flow, not live
equip/removal success, exact native fonts, item tint, hover behavior or complete
visual parity. Native window layout/art extraction and browser tests must keep
their own evidence and limits.

## Browser and configured-server checkpoint

The local existing-character playtest on27September2026UTC received all five
henna response types through the updated gateway. Both real lists were empty;
the level6 character had no tattoos or eligible dyes. Read-only detail queries
for original symbol1 returned dye4445, amount10/fee37000 for drawing and
amount5/fee7400 for removal, with512Adena and explicit before/after stats.
These are configured-server responses, not a claim of official prices or
eligibility. No equip/remove request was sent to the live server. No account,
item grant, teleport or progression edit was made.

The offline Elbera Tools page replayed the real empty list and those unchanged
detail values. For exercising row selection, one artificial list row was copied
from each detail response; the page labels that inspection setup explicitly.
It is not evidence that either row was available to the live character.
Browser checks exercised both source panels, all six arrows, distinct dye and
symbol icons, fee/owned-money text, Back and OK request selection. Back uses the
two verified preferred-base caller words. OK closes the window and records a
local request; no success snapshot is generated. The captured console is clear.
The remove-name line clips in its source-sized box; native metrics/overflow and
complete text/frame parity remain open rather than widening the original box.

The final game build was also reloaded and connected with Online. Inventory
shows source class0's one tattoo row while the received snapshot reports zero
usable slots and no symbols; those are deliberately different inputs. The
private receipt and browser images remain under `tmp/restart-audit/henna-*`.
Successful live tattoo application/removal, subclass changes and persistence
of nonempty symbols still require eligible ordinary gameplay verification.
