# Player appearance packet evidence — Elbera Tools

The gateway now preserves the current server `sex`, `hairStyle`, `hairColor`
and `face` through both player-info paths. `enterWorld.char` and each subsequent
`charSheet` use **UserInfo**; `addPlayer` uses **CharInfo**. The earlier character
selection snapshot remains available for selection, but cannot override a
later UserInfo packet. Zero remains an explicit received value. Missing fields
are not replaced with selection values or zero.

This is a transport correction, not a claim that every hairstyle, hair color
or face is already rendered correctly. The browser must resolve those inputs
against its original assets and report unsupported cases separately.

## Original packet evidence

`tools/ui/check_appearance_native.py` reads the owner's original Engine.dll,
SHA256 `07b24af4ab55e4230d0a7949df5b07565319e62a1b20f38fefb16ebe54821ad0`,
and decodes the existing section in memory using the shared pinned recovery
helper. It never executes or writes a native binary.

Both readers pass the same native `User` destinations to Disassemble:

| Field name in configured server | User offset | UserInfo field / argument push VA | CharInfo field / argument push VA |
|---|---|---|---|
| sex | `+0x50` | 7 / `0x104346fb` | 7 / `0x1043696f` |
| hairStyle | `+0x240` | 117 / `0x104343c4` | 63 / `0x104367e7` |
| hairColor | `+0x244` | 118 / `0x104343bd` | 64 / `0x104367e0` |
| face | `+0x248` | 119 / `0x104343b6` | 65 / `0x104367d9` |

Field numbers are zero-based, exclude the opcode, and count each string as one
wire field. Each native `S` consumes two call arguments: destination and
capacity. The verifier checks the complete argument push order, rather than
assuming field number equals argument number. Native format strings are at
`0x1088ae38` (UserInfo) and `0x1088b080` (CharInfo). The three appearance DWORDs
follow the four speed/collision doubles in both formats.

UserInfo saves `&User.sex` at `0x10434420`, after 29 pushes, and reloads it at
`0x104346de`, after 124 pushes. The two apparent stack offsets refer to the
same entry-relative slot: `0xe8 − 29×4 = 0x264 − 124×4 = 0x74`.
CharInfo passes `&User+0x50` directly. Named `User::GetMeshType` also reads
`+0x50` at `0x10480c05` to distinguish its model branches.

The native Disassemble `d` dispatch resolves to `0x1040274d`; its retained
instructions copy one DWORD and advance four bytes. The checker verifies that
branch and both packet calls. Its default JSON output includes the two
recovered reader-range hashes and current configured-writer fingerprints.

The installed aCis `UserInfo.java` and `CharInfo.java` independently write
`getSex().ordinal()` in the header, followed later by `getHairStyle()`,
`getHairColor()` and `getFace()` in that order. This identifies the configured
server field names and shows agreement with the original wire destinations.
The evidence here does not independently close every original texture/mesh
selector using those destinations.

## Equipment banks and native hair-selection inputs

The gateway preserves every received equipment word, rather than only the six
previously rendered armor/hand fields. UserInfo has seventeen words in each of
two distinct banks: first item **object IDs**, then item **template IDs**.
CharInfo has twelve template-ID words and no corresponding object-ID bank.
The layouts are not interchangeable:

| Packet | Received word order |
|---|---|
| UserInfo, each bank | `hairall, rear, lear, neck, rfinger, lfinger, head, rhand, lhand, gloves, chest, legs, feet, cloak, rhand2, hair, face` |
| CharInfo | `hairall, head, rhand, lhand, gloves, chest, legs, feet, cloak, rhand2, hair, face` |

`paperdoll` carries template IDs for mesh/item lookup. `appearanceItems`
carries the bank consumed by the native presence checks: UserInfo's first,
object-ID bank for self, and CharInfo's template-ID bank for remote players.
`paperdollObjectIds` remains available separately on `charSheet`. Entry also
carries both `paperdoll` and `appearanceItems`, so model loading cannot discard
the initial equipment context. Unreceived remote jewelry fields remain absent;
zero and negative received words are preserved. `rhand2` is retained as a
separate word and is never used as a substitute for an empty `rhand`.

The original packet argument-address checks bind UserInfo fields 25–41 and
CharInfo fields 9–20 to the `User + 0x98` slot bank. UserInfo uses native slots
0–14, 17 and 18; CharInfo uses 0, 6–14, 17 and 18. The missing slots are not
filled with fabricated words. The named `User::HaveItem` body at `0x10480f40`
compares `[this + slot*4 + 0x98]` against zero (`0x10480f4b`) and returns the
signed `> 0` result (`0x10480f52`). Consequently, template IDs cannot replace
self object IDs merely because both are positive integers.

The named `User::GetItemClassID` at `0x10482100` separately distinguishes local
and remote users through `+0x94`. UserInfo marks the local branch at
`0x10434a61`. The local path resolves object IDs through the original
`UNetworkHandler::GetItem` virtual slot `+0xa0`, whose named body is
`0x1042b8c0`; the remote path already has template IDs. Submesh parts 6/7/8
select helmet/accessory inputs, with the local part-8 branch additionally
checking the resolved item's category/body-part before choosing slot 17 or
18. The checker retains that distinction instead of interpreting every
accessory presence word as a directly usable mesh ID.

This closes the ordinary UserInfo/CharInfo transport and presence-bank join.
It does not prove party-equipment update behavior, creator initialization,
arbitrary equipment-to-hair table-key matching, or the full local item-class
selection pipeline in the browser. Those remain separate source/runtime
boundaries.

## Runtime and verification scope

The parser requires the appearance DWORDs as part of its normal packet prefix.
A truncated prefix produces a parse error before player events are emitted.
Existing unrelated packet-tail compatibility remains unchanged; this is not
an exact-end validation of all UserInfo/CharInfo variants. Native malformed
packet behavior is not adopted as the gateway's error policy.

Self updates emit `charSheet` without re-entering the world. Remote updates
emit `addPlayer` with the new appearance. Retired or closed game connections
cannot forward either player-info path or add remote-player identities to the
replacement connection's maps.

Reproduce offline:

```sh
PYTHONDONTWRITEBYTECODE=1 python3 tools/ui/check_appearance_native.py --check
node --test gateway/test/appearance-packets.test.js gateway/test/collision-packets.test.js
```

The native check covers 29 appearance instruction anchors, two original
reader formats and eight appearance destinations, plus 23 equipment anchors
and 29 exact equipment-bank destinations. The portable fixtures contain synthetic
values, variable-length UTF-16 names/titles, distinct doubles, updates to zero,
and out-of-creation-range values to detect accidental transport coercion.
They also test every truncated prefix through the last appearance DWORD,
retired/closed connections, missing-field behavior in the bridge, distinct
equipment/presence values, explicit unequips, and absence of a right-hand
fallback. Actual browser-module tests also exercise latest equipment replay
during model loading and session retirement. No
account, live packet capture or proprietary asset payload is checked in.
