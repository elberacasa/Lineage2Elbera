# Elbera Tools: original shop transfers and live purchase

The browser ShopWnd uses freshly checked Interlude Interface.u script rules,
Interface.xdat geometry, sysstring-e.dat labels and systemmsg-e.dat dialogs.
Configured aCis prices/stock/inventory results remain server authority and
interoperability evidence; they are not proof of official server economics.

## Reproduce the source check

```sh
python3 tools/ui/check_shop_source.py --check
node --test editor/world/test/shop-transfers.test.mjs editor/world/test/gamedata-cache.test.mjs gateway/test/shop-packets.test.js
```

The read-only source verifier freshly extracts ShopWnd from the owner's pinned
Interface.u TextBuffer, checks seven normalized function fingerprints and29
branch anchors, then decodes15 layout/reset records and11 language records.
It compares those selected exports with the local generated files. It does not
bundle original scripts, language text, artwork or private playtest receipts.
The native background path adds39 instruction anchors and five complete code
ranges. Source hashes are pinned in the verifier. System-message parsing retains the
existing bounded record-header search; this is not a complete native DAT-tail
or renderer proof. Shared native anchor/frame evidence is in
[native-layout-evidence.md](native-layout-evidence.md).

## Recovered behavior

- ConsumeType1/2/3 identifies stacks. Top-to-bottom prompts only for a stack
  whose ItemNum differs from1; bottom-to-top prompts for every stack. Unknown
  original ConsumeType does not invent an action. Buy quantity uses param-1;
  sell/return uses the supplied count. Dialog72 is the shared original NumberPad.
- Blank/zero quantity does nothing here. This differs from inventory destroy,
  which forwards zero. The caller owns that distinction, not a generic clamp.
- Direct buy appends a count1 row, including repeated nonstackable class IDs.
  Quantity confirmation resolves the first current matching ClassID and merges
  into its first cart match. Sell top-to-bottom clamps to available count.
- Source sell-return overshoot can restore more than the previous cart count.
  Its price accumulator also differs when a new top row is created: assigning
  ItemNum before the correction bypasses that correction. A two-item regression
  preserves this small-number behavior rather than silently recomputing a
  different total. The server still validates ownership when selling.
- Before buy, requested counts are summed per class across all cart rows.
  Exceeding positive merchant stock shows Warning1338, leaves the cart open
  and sends nothing. Confirming that warning does not buy. Ordinary OK sends
  every cart row, including an empty cart, and hides without a second dialog.
- Original strings134/136–143 provide the title, pane labels, Adena, Price,
  OK and Cancel. Opening hides Inventory and displays the list's supplied
  Adena snapshot. It does not fabricate merchant money from an old inventory.
- Total window height is401px, including the20px title strip. Children retain
  source coordinates. Creation uses the original common parent anchor4/4;
  reset uses the separate decoded anchor1 offset(200,150). Saved browser
  placement remains a browser adaptation. The normal backdrop uses its source256x381 sampling rectangle
  at(0,20); broader rendering remains limited as documented below.

Browser lifetime guards invalidate pending source loads and owned dialogs on
replacement/close/reconnect. Rendering is synchronous after metadata resolves,
so an older item render cannot append into a new list. Failed metadata loads
can retry on a later request while successful results and in-flight requests
remain shared. No automatic retry loop or replacement data is introduced.

The gateway preserves exact rows and positive signed DWORD item/count fields.
Malformed, oversized or unresolved rows reject the entire request; values are
not coerced and lists are not silently truncated to50. The only local row
bound is the encoded uint16 transport frame capacity. Server inventory/cart
limits remain server decisions. Retired sessions cannot restore merchant or
inventory identities, and a full ItemList replaces the object lookup map.

## Offline browser replay

Open [Original shop transfers](http://127.0.0.1:8083/test/shop-transfers.html)
from the Elbera Tools index. It uses actual ShopWnd/DialogBox controls and
original metadata/artwork, with explicitly simulated stock, price, money and
object identity. Confirm records a local request and never connects to a server.

Actual browser checks covered two separate Magic Ring116 count1 cart rows;
a positive-stock1 list rejecting a two-ring cart with the original warning;
and a three-potion sell using NumberPad All, producing exactly object1/count3.
No captured browser warnings/errors. These checks prove those controls and
requests, not acceptance of a real sale or full native drawing parity.

## Ordinary live browser purchase

The existing PortAudit character traveled from the lighthouse area to Katerina
using the existing-character protocol tool, recorded separately in ignored
`tmp/restart-audit/shop-travel-live.jsonl`. It used actual source-geodata paths
and observed server origins; no teleport, grant, SQL edit, farming loop or
character creation was used. This travel receipt is not browser movement proof.

After that tool disconnected, the browser logged in normally. A visible NPC
interaction opened Katerina's actual HTML. Selecting Buy Consumables and
Minerals opened received BuyList14. One Lesser Healing Potion1060 cost103;
NumberPad1 → Confirm → shop OK produced the server's thank-you HTML and item
in Inventory. Adena changed615→512. Using that inventory slot removed the
potion and the server chat reported its use. No captured browser errors.
Screenshots/receipts remain private under `tmp/restart-audit/`.

This verifies one real buy/use loop on the configured server. The character
was at full health, so it does not measure healing amount/timing or effect
parity. No real sale, limited-stock purchase, equipment purchase, destructive
inventory action or class progression was exercised in this loop.

The interaction also exposed severe body/view occlusion near the merchant
and dark interior rendering. A subsequent ordinary browser reproduction with
the Elbera camera inspector attributed that recorded close-up: MoveToPawn
carried distance 150 while the player was about 94.05 units from Katerina. The
old handler nevertheless walked the visual player into the NPC's center.
The camera's walking-height samples then collapsed its requested 2 m boom to 0.
Both drawn body bounds contained the camera; the actors' scales were unchanged.

After the bounded approach correction, repeating the same ordinary clicks
opened the NPC dialog while retaining the player's position and 2 m camera
distance. Body-bound distances were about 1.81 m/player and 2.76 m/NPC. No new
captured browser warnings/errors. This pass made no purchase or inventory
change. Screenshots, timestamps and rendered diagnostic receipts stay private.
See [grounding and approach evidence](native-grounding-evidence.md).

This fixes the reproduced approach defect, not native camera collision or
all merchant views. The legacy camera still uses a walking-height march and
a provisional visual pivot. Original Trace(false) includes static actors,
terrain and BSP; ordinary nonstatic pawns are not in that selected category.
The next replacement must use original collision structure, not treat rendered
building polygons as the native solid tree. See [camera evidence](native-camera-evidence.md).
The original Draw path dispatches to the compiled camera override. Shipped
settings select its nonzero extent (0.1, 0.1, 5) sweep; the stored script's ray
must not select the browser's collision primitive. Dark interiors and full
village readiness remain open.

## Remaining fidelity boundaries

Preview, source drag/AllItemCount lifecycle, weight preview, native item
price/enchant tooltips, exact INT64 high/low-word and overflow behavior,
quantity badge painting, TextBox autosize/alignment, focus/keyboard behavior,
pressed/hover art, and remaining control drawing remain open. The shared
NumberPad retains its documented caret/IME/paste/width limits. The selected normal background is now source-backed (below); recovered
bounds/sampling alone do not certify alpha, filtering, blending or all pixels. Values outside the certified signed
quantity range are refused instead of guessed or wrapped.

Historical browser harnesses are maintenance artifacts until actually run;
syntax/source checks do not count as a browser pass. The full-port goal remains
active. Source, generated data and live account state stay private; no push or
deployment is part of this checkpoint.

## Original shop background drawing

The Elbera Tools source check now also verifies the selected backdrop against
the original NWindow code, rather than inferring a frame from its appearance:

```sh
python3 tools/ui/check_shop_source.py --check
```

It freshly reads the pinned XDAT, checks 39 native instruction anchors and five
complete code ranges, and compares the private exported layout's `relativeSize`
and skin crop metadata. NWindow.dll SHA256 is
`af6c3437f3ccf1b26af8b066e0bbd791c7909c94bd3c7d9e3c68c5edcfe059a7`,
loaded statically at image base `0x10000000`. The checker emits the individual
range hashes when run without `--check`; it neither executes the DLL nor
redistributes original code or artwork.

The original ShopWnd record starts at XDAT byte 380631. Its explicit frame
field is 1 at byte 380794, and frame direction is 3 at byte 380834. The native
window serializer at `0x100f3c54` identifies these as XMLWindowData `+0xb8`
and `+0xf0`. Creation adds frame style `0x80` at `0x100f3667` and applies the
direction through `NCWnd::SetFrameDirection` at `0x100f36a8`.
The relative-height helper at `0x1005bf40` checks that style and direction;
its branch at `0x1005bfcb` subtracts the original double constant **20.0**
from the parent's height before applying the height rate and offset. With
ShopWnd's 256 by 401 frame and this child's rates 1.0/1.0 and offsets 0/0,
the backdrop therefore resolves to **256 by 381**, at its source position
**(0, 20)**. Shared anchor arithmetic is covered separately by
[the native layout evidence](native-layout-evidence.md).

BackTexture starts at byte 380957. Its specialized serializer at
`0x100eda54` supplies `L2UI_CH3.StoreWnd.Store1_back`, texture type 0,
layer 2, U/V 0/0 and explicit texture width/height 0/0. These zero dimensions
cause `NCTextureCtrl::OnPaint` at `0x100538b8` to use the resolved control
width and height for its source rectangle. Type 0 selects `0x10053921`,
which calls `NCGDevice::DrawTexture` once at `0x1005395e`: destination
`(0, 0, 256, 381)` within the positioned control, source
`(0, 0, 256, 381)`. This path does not split the texture into nine slices.

The exported sprite is 256 by 512 with its measured content at
`(0, 0, 256, 381)`. A 256 by 381 element positioned at (0, 20), using
`Skin.apply` with content dimensions 256 by 381, samples those first 381
rows at 1:1. This is the bounded reason for the shop-specific correction;
the content measurement alone was not the authority for the native size.

This proves the selected backdrop's frame adjustment, dimensions and sampling
rectangle. It does not certify every NCTexture type, other framed-window
rules, inherited alpha resolution, animation, filtering, GPU blending, font
painting or a general nine-slice renderer. Browser UI magnification remains
a deliberate adaptation. No broader pixel-parity claim follows from the
corrected shop background.
