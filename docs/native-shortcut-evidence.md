# Elbera Tools — server-authoritative shortcuts

The original client and the configured server both support a saved hotbar.
The browser's former `l2vzla.hotbar.<characterName>` storage bypassed that
protocol. This checkpoint bridges the existing server state and requests;
it does not invent a starter layout or change server persistence rules.

## Reproduce

```sh
python3 tools/ui/check_shortcut_native.py --check
node --test gateway/test/shortcut-packets.test.js
```

The native check needs the pinned private Engine.dll/NWindow.dll under
`assets/interlude/system/` and Capstone. It uses the shared in-memory decoder,
runs no executable, and outputs only provenance/verification results. Packet
tests are synthetic and require no originals, account, socket or database.

## Original protocol evidence

| Operation | Original proof | Payload after opcode |
| --- | --- | --- |
| Register request `0x33` | Exported `UNetworkHandler::RequestShortCutReg`, body `0x10406ab0`; format push `0x10406af3` | `D type, D room, D id, D UserShortCut` |
| Delete request `0x35` | Exported `RequestShortCutDel`, body `0x10406bc0`; format push `0x10406bfd` | `D room` |
| Register reply `0x44` | Registration `0x10837166`, body `0x10414290` | One variable-width row |
| Full list `0x45` | Registration `0x10837183`, body `0x10414600` | `D count`, followed by rows |
| Delete reply `0x46` | Registration `0x108371a0`, body `0x104149c0` | Native reads `D room`; current server adds one `D` |

Each row begins with `D type, D room`. Original row tables at `0x10414538`
and `0x104148e4` have five branches: item, skill, action, macro, recipe.
Their payload formats are item `dddddhh`, skill `ddcd`, and `dd` for the
remaining three. The configured server writes the item's final two H words
as one augmentation DWORD: the four bytes are retained as `augmentationId`.
The skill byte is preserved as `skillFlag`; its meaning is not inferred.

Original `Interface.ShortcutWnd` declares ten pages of twelve slots and
updates controls using a flat shortcut ID. Its `EV_ShortcutUpdate`,
`EV_ShortcutPageUpdate`, and `EV_ShortcutClear` handlers remain the UI-state
reference. `UIEventManager.EShortCutItemType` orders NONE, ITEM, SKILL, ACTION,
MACRO, RECIPE. NONE is not a stored binding in the server's ordinary paths;
the implemented row decoder accepts the five actual binding types.

**Ordinary registration uses `UserShortCut=1`.** NWindow's skill control
pushes type 2, room, skill ID, and literal 1 (`0x10185c5c`) before calling
`0x1015a3b0`. Independent item (`0x10177438`) and generic drag/swap
(`0x10048262`, `0x10048300`) callers also push 1. That shared method dispatches
through network virtual slot `0x280`, which resolves to the named register
request. These callsites support ordinary player registration only; the
meaning and registration path of other owner values are not established.

Native shortcut use `0x34` exists, but the configured server handles it as
DummyPacket. Consequently this checkpoint retains direct skill/item/action
use. Original optimistic widget updates before server confirmation have not
been proved; the browser uses server echoes as its committed binding state.

## Configured-server behavior and boundaries

`ShortCutInit.java`/`ShortCutRegister.java` write the same row shapes.
`RequestShortCutReg.java` reads the original four DWORDs, obtains a skill's
actual learned level, and emits the register response. `ShortcutList.java`
saves bindings by character ID, slot, page, and class index. EnterWorld sends
ShortCutInit after UserInfo/ItemList; subclass restoration also sends a full
list. Skill upgrades refresh every matching shortcut through register replies.

Deletion of an existing binding sends a delete response and updates storage.
Deleting an already-empty slot sends no response. The server's additional
delete DWORD is retained as `unknown`, since the original reads only the
room. The client need not send redundant empty-slot deletes.

Register responses are emitted **before** `ShortcutList.addShortcut` checks
item/macro/recipe integrity and writes storage. An echo alone does not prove
database persistence; an ordinary reconnect and fresh full list are the
observable restoration check. No SQL is used by these tools.

The gateway validates complete packets before emitting them. Pre-entry Init
replaces older queued shortcut state; later changes are bounded by the 120
positions and flushed after matching world entry. It retains unsupported
macro and other-owner rows as data, while registration requests admit
ordinary items, skills, actions and original type 5 recipes. Local hotbars are not silently
uploaded over existing server state. These checks do not establish complete
macro, pet, item-reuse-display or original drag-and-swap behavior.


## Browser implementation and live checkpoint

The browser now consumes Init as a full replacement, and Register/Delete as
individual server updates. Skill, item, action and recipe assignments send requests;
received bindings determine the displayed slots. Pending positions are briefly
reserved to prevent two rapid “first free” requests overwriting each other.
This browser network guard expires after ten seconds without changing game
state; it is not an original game timing rule. Disconnect clears bindings,
learned availability and pending requests. Existing localStorage hotbars are
left untouched and are neither read nor uploaded.

On 2026-09-26 the existing level5 human fighter connected in the browser.
The initial server snapshot restored Attack, Pick Up, Sit/Stand and the
Tutorial Guide inventory object. Right-clicking Relax and Power Strike in
the skill window registered them into the first available slots. F2 used
Relax and produced the server's expected messages. Power Strike was then
removed. A fresh page and reconnect restored Relax while retaining that
removal, demonstrating server persistence independently of the old browser
store. Power Strike was subsequently restored as a useful binding. The
Tutorial Guide item was also assigned to a temporary additional slot and
removed through server echoes; no item was destroyed or consumed.

The private screenshot is `tmp/restart-audit/shortcuts-live.png`. No browser
warnings/errors were seen. The inventory initially opened partly outside the
narrow viewport and was moved using its title bar. Its later source-backed
placement repair is documented in [native-layout-evidence.md](native-layout-evidence.md).
Live subclass switching, all item reuse/augmentation displays, pet/macro
execution, recipe-binding persistence, exact native
optimistic updates and drag/swap/lock semantics remain unverified.

Recipe shortcuts now preserve the original three identities: the binding is
the `Recipe-c.dat` record **index**, the displayed name comes from its
`recipeItemId`, and its icon comes from `productId`. A type 5 shortcut requests
`0xAE` make-info; it does not send a craft request merely by activation.
New assignments require eligibility in a received recipe book; a restored
server shortcut may request info before a book has been opened. Browser
replay verified restored F1 activation through AE into Item Creation. This
does not prove reconnect persistence of a newly assigned recipe binding or
the complete native drag/swap state machine. See
[native-recipe-evidence.md](native-recipe-evidence.md) for source and protocol
details.

Portable browser-state checks:

```sh
node --test editor/world/test/shortcut-state.test.mjs editor/world/test/skill-state.test.mjs
```

## Source placement and the offscreen saved dock

`WindowsInfo.ini` is a saved position file. Its horizontal shortcut dock is
`(347,722)`, so restoring it unchanged places the entire bar below a 720px
browser viewport. The former constructor then reapplied this dock **after**
WndMgr restored the player's browser position. Neither operation was a
native default-position rule.

Fresh reads of the pinned `Interface.xdat` distinguish creation from reset:

| Original record | Byte span | Size | Self / target anchor | Target |
| --- | --- | --- | --- | --- |
| `ShortcutWnd` | 384262–384604 | Parent-relative 1×1, zero offsets | TopLeft / TopLeft | Default parent |
| `ShortcutWndVertical` | 384604–384979 | 46×504 | CenterRight / CenterRight (6/6) | Default parent |
| `ShortcutWndHorizontal` | 402372–402780 | 504×46 | BottomRight / BottomRight (9/9) | `ShortcutWnd.ShortcutWndVertical` |

All three position offsets are zero. The separate reset table at
532005–534247 contains the qualified name
`ShortcutWnd.ShortcutWndVertical` at byte 533065: anchor 6, offsets 0/0,
`anchored=false`, and no replacement dimensions. It contains **no horizontal
shortcut reset record**. The browser previously missed the vertical rule by
looking only at saved docks/unqualified names. Numbered INI sections are not
assigned invented window identities.

`Interface.ShortcutWnd` was reread from the original package TextBuffer:

- `OnDefaultPosition` clears both expansion options, selects vertical,
  resets the three pages to 0/1/2, and calls `ArrangeWnd`/`ExpandWnd`.
- In the ordinary non-joypad path, `ArrangeWnd` corrects negative vertical Y
  to 0, or negative horizontal X to 0. It does not add a right/bottom margin.
- `OnRotateBtn` attaches the newly active bar's BottomRight to the old
  bar's BottomRight and clears that active anchor. It does not reread the
  INI dock or reset page/bindings.
- `Expand1`, `Expand2` and `Reduce` show/hide extra windows and update
  options/buttons; they do not move or resize the main bar. The port's
  extra negative root margin shifted the main bar a second time, despite
  its extra pages already having negative local Y. That duplicate shift is
  removed; actual main-bar position survives expand/rotate/reduce.
- `OnClickExpandShortcutButton` cycles through one extra page, two extra
  pages and collapsed. Only the two-extra state uses ReduceButton; the first
  two states use ExpandButton. The browser now preserves this three-state
  cycle for its horizontal pages. `OnPrevBtn`/`OnNextBtn` wrap between0 and9;
  the displayed main page is `CurrentShortcutPage+1`, with no authored `/10`.
- `ArrangeWnd` and `HandleShortcutJoypad` hide JoypadBtn unless the separate
  joypad-enabled event says otherwise. The unported controller lifecycle no
  longer paints a disabled placeholder over ordinary bar controls.

The common native anchor names/enums, integer conversion and update formula
are checked by `check_layout_native.py`: name binding at
`0x101148b4`/`0x101148e2` establishes CenterRight 6; BottomRight is 9 via
`0x10114956`/`0x10114984`; anchor update at `0x1005c7ad..0x1005c7b6`
adds the target anchor point and subtracts the self anchor point.
`ReArrangeSavedWnd` at `0x1014d6a0` applies saved position, calls
`IsOutOfRange` at `0x1005c100`, then requests a reset when none of the four
corners lies inside the root rectangle. The corner test is inclusive and
is not general rectangle intersection. See the shared
[layout evidence](native-layout-evidence.md) for the source boundaries.

The browser now applies creation/saved-INI placement **before** restoring
the player's browser position. Missing INI placement uses the verified
creation relation: at 1280×720 and scale 1, vertical is (1234,108), and
horizontal BottomRight alignment gives (776,566). These are calculated
examples, not runtime coordinate constants. An admitted browser position
survives restoration; ordinary negative-axis arrangement still applies.
If all corners are outside, the browser invokes the verified **full script
reset**, giving vertical CenterRight and page 0. On show/resize, WndMgr calls
the same repair. No 40px margin or proportional game-UI scaling is introduced.

**Boundary:** the browser merges the native top-level/active child windows
into one movable element. Calling full-script reset for an offscreen merged
bar is a deliberate browser lifecycle adaptation. The native horizontal
missing-default fallback has not been established; this patch does not
claim it. Browser body/viewport is the port's parent rectangle. Full native
parent lookup, joypad mode and original option/position persistence remain
outside this placement change. Independent expanded pages and vertical expansion
are closed in the following checkpoint.
Without the qualified reset metadata the runtime does not invent a position.

Pinned originals:

- `Interface.xdat` SHA256:
  `a7969a86d3b676d95cfd42cfd6cd0742c07d7941250dbb63a2ba6d937961c1f4`.
- `Interface.u` SHA256:
  `5da491d8234863a94bfa1959bcb0be2cd5cdf81110003785436eecc04c86decd`.
- Recovered `ShortcutWnd` source, UTF-8 SHA256:
  `cebb4bceaa18e5ab5b19b9050b2a4ea7765af9968d701258a18c5b848098d2e1`.
- `NWindow.dll` SHA256:
  `af6c3437f3ccf1b26af8b066e0bbd791c7909c94bd3c7d9e3c68c5edcfe059a7`.

Read-only original checks and source-free browser lifecycle tests:

```sh
python3 tools/ui/check_layout_native.py --check
python3 tools/ui/mine_windowsinfo.py --check
node --test editor/world/test/shortcut-position.test.mjs
```

To reproduce the specific creation/default records without trusting generated
JSON or writing new assets:

```sh
python3 - <<'PY'
import hashlib, sys
from pathlib import Path
sys.path[:0] = ['tools', 'tools/xdat', 'tools/ui', 'tools/uscript']
from parse_xdat import scan
from mine_windowsinfo import original_defaults
from l2lib import load_package
from extract_uscript import sources_from_package
raw = Path('assets/interlude/system/Interface.xdat').read_bytes()
assert hashlib.sha256(raw).hexdigest() == 'a7969a86d3b676d95cfd42cfd6cd0742c07d7941250dbb63a2ba6d937961c1f4'
_, rows = scan(raw)
for name, offset in [('ShortcutWnd', 384262), ('ShortcutWndVertical', 384604), ('ShortcutWndHorizontal', 402372)]:
    row, = [r for r in rows if r['name'] == name and r['off'] == offset]
    print(name, {k: row.get(k) for k in ['off', 'end', 'width', 'height', 'relativeSize', 'position']})
defaults, provenance = original_defaults()
assert 'ShortcutWnd.ShortcutWndHorizontal' not in defaults
print('vertical reset', defaults['ShortcutWnd.ShortcutWndVertical'])
path = Path('assets/interlude/system/Interface.u')
assert hashlib.sha256(path.read_bytes()).hexdigest() == '5da491d8234863a94bfa1959bcb0be2cd5cdf81110003785436eecc04c86decd'
package, _ = load_package(path)
source = dict(sources_from_package(package))['ShortcutWnd']
assert hashlib.sha256(source.encode()).hexdigest() == 'cebb4bceaa18e5ab5b19b9050b2a4ea7765af9968d701258a18c5b848098d2e1'
print('original ShortcutWnd ScriptText fingerprint verified')
PY
```

The portable suite executes the real constructor, `render`, placement and
WndMgr lifecycle with synthetic source metadata; only individual control
art is stubbed. It covers saved-position precedence, offscreen repair,
inclusive boundaries, negative-axis correction, expanded main-bar geometry,
rotation, optional UI magnification and missing source metadata.

## Independent extra pages and source drawer placement

The next checkpoint closes ordinary horizontal and vertical expansion. Fresh
`ShortcutWnd` ScriptText initializes three independent selected pages to 0/1/2.
Each Prev/Next pair wraps its own value across 0–9. `SetCurPage` alone calls
`ShortcutAPI.SetShortcutPage`; SetCurPage2/3 update their own twelve controls.
Selecting the same page in several bars is allowed. Rotation and collapse do
not rewrite those choices; the full source position reset does.

The geometry comes from a previously unexposed **drawer** block in the window
record, not from its common anchor. `XMLWindowData::Serialize` (0x100f3c20)
serializes four strings followed by 88 bytes before direction, offset,
fixed-direction and owner-string fields (+124/+128/+12c/+130 in memory).
Getter dispatch at 0x100f39be leads to NCFrameWnd::SetDrawerWnd (0x1001ea00)
and NCDrawerWindowInfo::Init (0x1001c820). The owner is resolved and the child
reattached in InitOwnerWnd (0x100200e0). The extractor preserves these fields;
it does not interpret unused bytes when direction is zero.

| Original record | XDAT offset | Direction | Owner | Offset / fixed |
| --- | ---: | ---: | --- | --- |
| ShortcutWndVertical_1 | 391546 | 1 | ShortcutWndVertical | 0 / 1 |
| ShortcutWndVertical_2 | 396958 | 1 | ShortcutWndVertical_1 | 0 / 1 |
| ShortcutWndHorizontal_1 | 409413 | 3 | ShortcutWndHorizontal | 0 / 1 |
| ShortcutWndHorizontal_2 | 414886 | 3 | ShortcutWndHorizontal_1 | 0 / 1 |

DrawerShowTransitionFinished (0x1001dea0) dispatches through the table at
0x1001e03c. Direction 1 anchors TopLeft to the owner's TopLeft with
(-truncate(own width), offset); direction 3 uses (offset, -truncate(own height)).
The fixed flag skips screen-edge direction reversal (0x1001f0f4–0x1001f176).
Thus these source drawers open left/up by their own 46-pixel thickness.
The four records share the corresponding main bar's dimensions, background,
first-slot geometry, F-key art and label geometry; the checker compares them
against fresh original bytes. The existing measured shared background wells
remain the slot-art placement evidence.

All three page labels use their own source anchors and center alignment:
horizontal CenterLeft with offset (10,0), vertical TopCenter with (0,16).
At native dimensions these resolve to (10,18) and (13,16). The runtime no
longer mistakes raw offsets for final control positions or falls back to a
similarly named joypad control. Lock/Unlock artwork now follows source state.

`check_shortcut_native.py --check` pins seven complete native ranges and31
instruction sites for this path, alongside original script/packet checks.
Portable parser tests cover drawer bounds and inactive fields. The actual
ShortcutWnd tests cover both orientations, independent wrapping, duplicate
snapshot updates, correct clicked/dropped page, collapse/rotation, labels,
lock artwork and absence of source drawer metadata. An independent read-only
review reproduced the field offsets and native completed-position mapping.

The browser applies **completed drawer positions immediately**. Original
slide motion/timing and transition clipping remain unported. General native
name lookup, joypad controls, complete locking/drag behavior, font metrics,
option persistence and complete window painting are still separate gaps.
Original/generated assets and local browser receipts remain private.
