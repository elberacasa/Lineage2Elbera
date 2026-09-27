# Elbera Tools: original shared UI layout and saved positions

The shared record decoder now follows the original `NWindow.dll` serializer.
The old “24.8 fixed-point” explanation was incorrect: an empty string byte
preceded ordinary signed int32 offsets. It accidentally decoded positive X
offsets when the anchor target was empty, but lost negative X and named-target
records. Raw offsets also are not resolved control positions.

## Source identity and reproduction

| Original input | SHA256 |
| --- | --- |
| `NWindow.dll` | `af6c3437f3ccf1b26af8b066e0bbd791c7909c94bd3c7d9e3c68c5edcfe059a7` |
| `Interface.xdat` | `a7969a86d3b676d95cfd42cfd6cd0742c07d7941250dbb63a2ba6d937961c1f4` |

```sh
PYTHONDONTWRITEBYTECODE=1 python3 -m unittest discover -s tools/xdat -p 'test_parse_xdat.py'
PYTHONDONTWRITEBYTECODE=1 python3 tools/ui/check_layout_native.py --check
PYTHONDONTWRITEBYTECODE=1 python3 -m unittest discover -s tools/ui -p 'test_layout_native.py'
PYTHONDONTWRITEBYTECODE=1 python3 tools/ui/mine_windowsinfo.py --check
PYTHONDONTWRITEBYTECODE=1 python3 tools/xdat/parse_xdat.py --check
```

These are reusable Elbera Tools inspections; original client files are not
distributed with the tools. The first command needs no original files. The
native check reads the pinned originals and checks 174 instructions, 11 complete saved-position code ranges, literal names and vtable entries through
the existing PE/Capstone helper. The portable layout tests require no originals. These check commands write no generated assets.
The parser's `--check` validates its source decode; it does not establish that
an existing `interface.json` has been regenerated or adopted by the browser.
All addresses below are virtual addresses in NWindow, image base `0x10000000`.

## Native common serialization

`XMLUIData::Serialize` at `0x100ef8c0` is identified by its original diagnostic
name at `0x10269c6c` and the handler's reference at `0x100efb03`. Following the
common name/parent strings and existing opaque flags, it writes:

```text
int32 sizePresent
if sizePresent:
    int32 sizeKind
    if sizeKind != 0:
        int32 width, height
    else:
        FString relativeSizeReference
        float32 widthRate, heightRate
        int32 widthOffset, heightOffset
int32 positionPresent
if positionPresent:
    int32 selfAnchor, targetAnchor
    FString targetName
    int32 offsetX, offsetY
```

Size dispatch is `0x100cfd80`: nonzero kind uses `0x100cfb50`; zero uses
`0x100cfa90`. The relative-size serializer first calls the same FString
archive operator used by the named header fields, then writes four four-byte
fields. All 200 reviewed relative-size references are empty; the semantics of
a nonempty size reference are not claimed. The decoder preserves that string.

The optional position object uses `0x100cf4c0`, which writes its two enum
integers, FString at object `+8`, then signed offset pair at `+0x14/+0x18`
through `0x1003feb0`. The first of the previous parser's three “small enum”
integers is the position-presence flag, not an anchor enum.

`XMLUIData::Create` at `0x100f0800` passes those exact fields to native widget
vtable slot `+0xd8` at `0x100f0a7b–0x100f0a97`. For the checked native base
widget path this is `0x1005dbc0`: first enum becomes self field `+0x13c`,
second becomes target field `+0x140`, and X/Y become `+0x154/+0x158`.
This establishes the order from actual serialization through widget creation.

The decoder keeps `x`/`y` as raw offsets for existing consumers and adds:

- `position`: `selfAnchor`, `targetAnchor`, `target`, `offsetX`, `offsetY`.
- `sizeMode`: `absolute`, `relative`, or null when the size object is absent.
- `relativeSize`: the source reference, float32 width/height rates and signed
  width/height offsets. Existing `autosize`/`insets` aliases remain available.

No anchor position or target lookup is guessed in the exporter. The existing
opaque header flags are preserved. The `body` offset contract used by narrow
control miners is unchanged for every currently scanned source record.

### Deferred Window parents

`XMLWindowData::Serialize` at `0x100f3c20` calls the common serializer, then
writes a first FString at object `+0x88` (`0x100f3c5d`). The getter at
`0x100f1410` is identified by original `XMLWindowData::GetParent` diagnostic
name (`0x1026a688`), loads exactly `+0x88`, and occupies Window-data vtable
`0x1026b00c` slot `+0xb0`. `Create` reads this getter at `0x100f3b62` and
passes the name and native widget to `XMLDataManager::AddParentInfo` at
`0x100ca430`. Thus Window parents need not occur earlier in the file.

The decoder emits `declaredWindowParent` without replacing the raw common
parent. The literal `undefined` is retained: the native getter can consult
an inherited definition in that case, which this parser does not resolve.
Explicit names attach after all records exist, only if uniquely resolvable.
Missing or duplicate names and cycles remain roots with `parentResolution`
metadata. This also removes the old arbitrary first-name-wins attachment:
91 records have ambiguous common-parent names in this input and remain
explicitly unresolved. Further scoped hierarchy recovery is still needed.

`SubWndNormal` and `SubWndEnchant` are native deferred children of
`SkillTrainInfoWnd`; their empty common parent had hidden that relationship.
Five other windows, including QuestTreeWnd and DetailStatusWnd, declare
MainWnd as parent. Consumers must search recursively before adopting a
regenerated full tree. No existing full `interface.json` is rewritten here.

### Absolute dimensions and the frame boundary

The original Window instance vtable `0x10236fd4` uses
`NCWnd::SetWindowSize` (`0x1005ee10`) for slot `+0x128`. The common creation
path converts the serialized dimensions to float and calls that slot at
`0x100f0a27`. Height stores directly to native rectangle `+0x8c` at
`0x1005ef39`, and width to `+0x88` at `0x1005ef42`; those assignments add
no titlebar height. The native frame drawing and client-coordinate relation
still require separate verification. This evidence does **not** justify
adding 20 pixels to the source height, or claiming current browser frames
are pixel exact.

## All nine native anchor points

`UUIAPI_WINDOW::execSetAnchor` at `0x10114600` compares original names and
produces enum values. `NCWnd::GetAnchorPoint` at `0x1005a700` subtracts one
at `0x1005a756` before indexing its nine-entry table at `0x1005a8cc`.
The stored native enums are **1–9**, not 0–8.

| Enum | Original name | Width/height fractions | Native case |
| ---: | --- | --- | --- |
| 1 | TopLeft | 0, 0 | `0x1005a765` |
| 2 | TopCenter | 0.5, 0 | `0x1005a77d` |
| 3 | TopRight | 1, 0 | `0x1005a7a6` |
| 4 | CenterLeft | 0, 0.5 | `0x1005a7cc` |
| 5 | CenterCenter | 0.5, 0.5 | `0x1005a7f8` |
| 6 | CenterRight | 1, 0.5 | `0x1005a835` |
| 7 | BottomLeft | 0, 1 | `0x1005a84a` |
| 8 | BottomCenter | 0.5, 1 | `0x1005a854` |
| 9 | BottomRight | 1, 1 | `0x1005a868` |

The half constant at `0x1022f270` is exactly double 0.5. Left/top are integer
fields `+0x80/+0x84`; width/height are float fields `+0x88/+0x8c`, independently
visible in `GetRect` at `0x10058770`. Each computed point converts to an integer
through `0x101c19e0`. Its SSE path uses `cvttsd2si` at `0x101c19f5` (truncate
toward zero); the x87 fallback corrects its rounded result in the same
direction. Floor or nearest rounding is not interchangeable for odd sizes
or negative screen positions.

The anchor update at `0x1005c720` obtains the target and self points, then does:

```text
left += offsetX - selfPointX + targetPointX
top  += offsetY - selfPointY + targetPointY
```

The points include the current absolute left/top before truncation. A resolver
must preserve this order rather than rounding a combined width difference.
Zero enums have setter behavior (a zero self enum can inherit the target
enum); they are not another name for TopLeft. No reviewed position uses zero.

## Relative sizes are rates

`XMLUIData::Create` reads both fields with float loads at
`0x100f0a41/0x100f0a48` and calls the native relative-size slot `+0x130`.
`NCWnd::SetWindowSizeRel` at `0x1005cf50` stores the rates and offsets.
The width calculation at `0x1005bef8–0x1005bf00` is
`truncate(widthRate * parentWidth + widthOffset)`. The height path has the
same multiply/add at `0x1005c000–0x1005c009`, with additional native parent
frame/type handling before it. A zero height rate does not by itself mean
“use font/texture height”; its signed height offset remains part of the rule.
Full frame/type sizing and named-target lookup should be integrated alongside
the runtime resolver, not replaced with inferred content sizes.

## Measured impact and migration boundary

The same 1,962 headers and body offsets are found. All 1,786 previously
decoded coordinate pairs remain unchanged. The corrected cursor recovers
176 formerly null pairs: 153 absolute-size and 23 relative-size records.
All 200 relative-size records decode. There are 132 named position targets
and 405 records with a nontrivial anchor or target (320 child records and 85
parent-empty records). These are structural counts, not a count of currently
visible broken widgets: some consumers already compensate manually.

Examples requiring the shared semantics include:

| Source controls | Source rule |
| --- | --- |
| Dialog buttons and number pad | Center anchors; signed -40 offset; named sibling targets |
| Status right strip | TopRight/TopRight, X offset -4 |
| Target close button | TopRight/TopRight, offsets -10, 6 |
| Chat controls | BottomLeft anchors; negative offsets are not absolute top positions |
| Shortcut orientations and page controls | Named cross-window target, center/right/bottom anchors |
| Menu/SystemMenu/Inventory roots | BottomRight or CenterRight relative to their target rectangle |
| Minimap, party matching and skill training controls | Named control targets omitted by the old decoder |

Twenty-two relative-size records contain fractional rates: nine ClanDrawer
panes use height rate 0.9, ten EventMatchObserver controls use 0.5/0.4, Gametip
uses 0.2, and two ReplayLogo textures use additional fractions. The exact
serialized float32 values are preserved.

The initial shared-decoder checkpoint changed the decoder, tests and evidence only.
The saved-position follow-up below adds a separate narrow metadata export; it
does not regenerate the full interface tree. Remaining
work includes exact target resolution, hierarchy ambiguities in the current
name-based tree builder, three unmatched top-level declarations, native frame
sizing, control-specific fields and script-driven changes. The scan's complete
span coverage is not proof that every byte or widget behavior is decoded.

## Button system-string labels

`XMLButtonData::Serialize` (`0x100d4190`, original diagnostic name at
`0x1025d244`) calls the common serializer at `0x100d41c8`. After the position
object the common serializer writes three int32 fields, one FString, and one
last int32 (`0x100efa9e–0x100efacc`). Button then writes four FString texture
fields at object `+0x88/+0x94/+0xa0/+0xac` followed by four int32 fields at
`+0xb8/+0xbc/+0xc0/+0xc4`. The decoder walks these fields; it does not scan
for an integer or presume that target/texture strings have fixed lengths.

`XMLButtonData::Create` reads `+0xb8` at `0x100d48ea` and calls
`NCButton::SetButtonName` (`0x10003cf0`) unless the value is `-9999`.
That method multiplies the ID by 12 and accesses imported `GL2GameData` plus
`0x6a8dc`. The exported `UUIScript::execGetSystemString` (`0x100f9a60`)
uses exactly the same table and stride at `0x100f9ae2–0x100f9aeb`. Thus the
first Button int32 is a system-string ID; the other three remain unnamed.

All 352 Button records decode; 229 declare a system-string ID and 123 use
the unset sentinel. `QuestTreeWnd.btnClose` begins at source byte 340093,
and its ID at byte 340308 is **385**. Original `sysstring-e.dat` ID 385 is
**Abort**. Its encrypted SHA256 is
`33053b17ca8e1d157aec8fb40b4ef8542626338858ce6c7b4d799c7609554135`;
the decoded table SHA256 is
`e7bb21ebccb72ae1bc83054f1ddf85cb26e66bd9f40e89e2c7eea83bb08c3572`.
The existing `tools/dat/extract_gamedata.py` `decrypt`/`parse_sysstring`
functions independently recovered that entry from the original into a
temporary directory, removed afterwards. No labels were inferred from the
button's name. The shared exporter now emits the same `textId` property used
by TextBox controls; it does not change currently generated UI assets.

## TextBox autosize controls anchor extents

`XMLTextBoxData::Serialize` (`0x100ec0f0`) writes the common record, a
default-text FString, two int32 alignment/font enums, a background FString,
and six int32 fields. The last is object `+0xbc`, identified by native
`GetAutosize` (`0x100eb900`, diagnostic `0x1026815c`). Values -1/0/1 are
preserved as inheritance/off/on, not inferred from a zero declared width.
The shared decoder adds `textLayout.defaultText`, `autoSize`, `fontType`
and `alignEnum`; the separate existing textId/color/alignment fields remain.
This structural tail decodes 621 of 658 TextBoxes in the pinned file; the
remaining 37 are left without this metadata. All 37 trainer TextBoxes decode,
and the narrow trainer exporter asserts that complete inventory separately.

The constructor at `0x10052c20` copies its autosize argument to widget
`+0x350`. `RefreshTextCoords` (`0x10051af0`) asks the native font renderer
to measure into `+0x300/+0x304`, increments measured width by one
(`0x10051b67`), then when autosize is enabled calls `SetWindowSize` with
that width and measured height (`0x10051be7–0x10051bfb`). Thus the actual
native anchor rectangle changes after text is set. Left/center/right
alignment can also reposition the resized box before its anchor is reapplied.
`SetText` at `0x10052970` calls `SetProperText`, which refreshes nonempty
text; `OnLoad` refreshes again at `0x10051cfb`.

For the concrete trainer case, `SubWndNormal.txtMPString` declares width245
but also explicitly declares autosize1. Its following colon anchors to the
resized text rectangle, not x+245. Source literal colons are in defaultText.
Matching the original font's measurement remains a separate check; using
browser canvas width without source metric validation is not native proof.

The autosize getter resolves -1 through a same-type prototype getter
(`0x100eb93f`, `0x100eb94c`), then defaults to zero if no explicit inherited
value exists (`0x100eb959`). A raw -1 is not proof of either enabled or disabled.
The trainer has five inherited values: description and requirement-name
controls in both subwindows, plus the list's txtSkillList heading.

Right-aligned autosize first requests an X shift by old width minus new width.
However, the TextBox vtable chain `+0x144 → 0x10058ec0`,
`+0x148 → 0x100623e0`, `+0xbc → 0x1005c720` recomputes active anchors
from their saved offsets instead of using the requested movement delta.
`SetWindowSize` also reapplies anchors at `0x1005ef4a`. Both trainer SP
values explicitly use TopLeft and offset X140; their autosizing does not
justify adding a separate right-edge correction to that anchored position.


## Saved positions, initial placement and reset defaults are distinct

`WindowsInfo.ini` is read as saved coordinates, not as a universal first-use
layout at a fixed resolution. `NConsoleWnd::ReArrangeSavedWnd` at
`0x1014d6a0` checks whether each registered window saves its position, reads
`posX` and `posY` from that file, and applies both through `SetPosition`
(`0x1014d7dd–0x1014d7f9`). It then calls `NCWnd::IsOutOfRange` at
`0x1005c100`; only a true result calls window vtable `+0xc8`
(`0x1014d7fb–0x1014d810`). The original frame vtable `0x10236fd4`
resolves that to `NCFrameWnd::SetDefaultPosition` (`0x1001e960`), which
calls base `NCWnd::SetDefaultPosition` (`0x1005ffd0`) before the script
callback. The 1024×768 reference box in the old INI miner was only a
comparison box. It did not prove a native default resolution or scaling rule.

`IsOutOfRange` obtains the console root rectangle (`+0x50ac`) and negates
`NCRect::Intersects` (`0x1004fad0`). Despite that method name, the surviving
implementation is specifically a **directional four-corner test**:

```text
right  = truncate(window.left + window.width)
bottom = truncate(window.top  + window.height)
inside = any of (left,top), (right,top), (left,bottom), (right,bottom)
         lies inside the root rectangle, including its four boundaries
outOfRange = !inside
```

The point helper `0x100053e0` rejects strictly less than left/top or strictly
greater than right/bottom. A partially offscreen window is accepted even if
only a corner touches the screen. A window surrounding the viewport with no
corner inside fails this test; replacing it with general rectangle overlap
would change the original behavior. There is no 40-pixel margin or full-window
containment rule on this restore path. The source-free tests explicitly cover
all four exact edges, partial visibility, enclosing/crossing rectangles,
negative origins and truncation.

### Separate XDAT reset table

`XMLDefaultPositionData::Serialize` (`0x100d9a50`) reads an int32 count and
serializes each `XMLDefaultPositionItemData` through its vtable `+0x10`.
The item serializer `0x100d98f0` writes an FString followed by six int32s:

```text
windowName, anchor, offsetX, offsetY, anchored, width, height
```

In the pinned original, the count at byte **532005** is **56**. Those records
consume exactly bytes **532009–534246**. The unrelated final 20 bytes remain
outside this decoder. There are 53 unique names; MiniMapWnd_Expand,
ManorInfoWnd and MacroListWnd each repeat an identical record. The narrow
exporter retains their source offsets and rejects conflicting duplicate
records. It requires the complete original XDAT SHA256 and this exact table
boundary, rather than searching for a plausible window name.

`XMLDefaultPositionItemData::Create` (`0x100da0a0`) resolves its named window
and passes the six fields to widget vtable `+0xcc` (`0x100da119–0x100da13b`),
which is `NCWnd::SetDefaultPositionInfo` (`0x1005ca60`). Width/height getters
at `0x100d9490/0x100d9520` map the serialized -9999 sentinel to -1. Base
`SetDefaultPosition` first uses this saved info at widget `+0xa8` and calls
vtable `+0xd0`, `NCWnd::SetAnchor` (`0x1005dd10`), with the same anchor enum
for self and target and the stored offsets (`0x10060013–0x10060049`).
The setter clears named-target state, stores those fields and reapplies
anchors. `GetAnchorWnd` at `0x1005a660` resolves an explicit target if present,
otherwise the widget's actual parent node (`+0xb8 → +0xc → +4`). It does
not universally substitute MainWnd for that parent.

If `anchored` is zero, the reset then invokes `SetAnchor(0,0,0)` to clear
persistent anchoring **after** the computed position has been applied
(`0x1006004b–0x10060063`). Size -1/-1 skips dimension replacement. When explicit dimensions are present,
positioning occurs first using the existing dimensions; an unanchored reset
therefore keeps that position when the size changes afterwards. The reset
thus does not imply that every later resize should simply reapply this anchor.
The existing anchor formula above remains exact, including truncating each
absolute point before subtraction.

Inventory provides a concrete distinction:

| Record | Source fields | At parent (0,0,623,760), Inventory 256×401 |
| --- | --- | --- |
| Common creation record, byte180874 | self6 / target6, offsets0,-70 | (367,110) from origin0,0 |
| Separate reset record, byte533238 | anchor6, offsets-46,-50, anchored0, unchanged size | (321,130) from saved (722,127) |
| WindowsInfo.ini saved position | absolute (722,127) | all four corners outside, so reset path applies |

At a root of 1024×768 the same reset gives (722,134), whereas the supplied INI
says (722,127). Their difference is retained; the INI is not proof of the reset
formula. For a negative existing top position, truncation can change the
result by one pixel; rounding only a combined size difference is incorrect.
These values assume the supplied parent rectangle, not a claim that all native
window classes share the browser's current hierarchy. Common creation chooses
the console root when its caller supplies no parent (`0x100f0931–0x100f0948`).
Inventory's common parent is empty and its deferred parent is `undefined`;
the native getter can still consult an inherited definition before returning
empty (`0x100f1488–0x100f14f1`). That Inventory-specific inherited-parent
resolution is not certified by this checkpoint. Using the actual browser root
parent remains an explicitly scoped integration choice.

`mine_windowsinfo.py --emit` now adds `defaults` alongside unchanged `docks`
and `numeric`, without regenerating `interface.json`. Each default contains
`anchor`, signed `offsetX/offsetY`, `anchored`, `w/h` (null means unchanged),
and `sourceOffsets`. Provenance includes original file hashes, table span and
record count. Named paths and unimplemented windows remain data; they are not
silently attached to a guessed parent. Numbered INI identities remain unresolved.

### Resize and dragging remain separate native paths

`NConsoleWnd::RearrangePosition` (`0x1014da90`) restores minimized windows,
then sets the root size from imported `GSEKScreenX/Y` (IAT `0x1022c278/27c`).
The `+0x158` call there is `MaximizeWindow`, not general offscreen clamping.
`SetWindowSize` passes old/new parent dimensions to
`NCFrameWnd::RearrangePosition` (`0x1001fca0`) at `0x1005f00d–0x1005f02d`.
That method considers a group bounding rectangle and stored proportional
placement, with a distinct 200-pixel fit condition. Its complete group,
initialization and docking lifecycle has not been ported or certified here.

Dragging's optional sticky-window helper (`0x10061220`) is gated by imported
`GIsStickyWindow` (`0x1022c270`) and contains 10-pixel edge snapping. It is
not the saved-position repair or evidence for a browser resize clamp. This
checkpoint supports saved-position validation/reset and its exact metadata;
it does not claim full native resize, docking, frame geometry or hierarchy
fidelity.
