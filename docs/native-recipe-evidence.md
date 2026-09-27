# Original recipe data and self-crafting evidence

Elbera Tools checks the owner's original Interlude client to recover recipe
fields, the ordinary recipe book/manufacture flow, and the ingredient tree.
This is static source evidence. It does not establish configured-server recipe
rules, successful manufacture, or complete visual parity. Public manufacture
shops are outside this checkpoint.

Run with the locally supplied originals and the existing Python dependencies
(including Capstone):

```sh
python3 tools/ui/check_recipe_native.py --check --output tmp/restart-audit/recipe-native.json
python3 tools/ui/mine_recipes.py --check
```

The first command decodes Engine instructions only in memory and checks native
instruction sites, imported/exported identities, original script bodies and
explicit XDAT window titles. It never executes a native binary or connects to
a game. The second independently decodes the original catalog and compares the
private browser metadata and six original dynamic tree textures. `--emit` on
the miner writes those ignored outputs;
neither original data nor generated catalogs belong in the public repository.

The exact supported files are pinned in the checker: Engine.dll
`07b24af4ab55e4230d0a7949df5b07565319e62a1b20f38fefb16ebe54821ad0`,
NWindow.dll
`af6c3437f3ccf1b26af8b066e0bbd791c7909c94bd3c7d9e3c68c5edcfe059a7`,
Core.dll
`9462f87a5e77d21865e2e00264efd44df25feb47aa78f8a72e9cf66ce4e919bf`,
plus Interface.u, NWindow.u and Interface.xdat. The miner separately pins the
encrypted recipe-c.dat, SysString and ItemName files. A different build is
rejected rather than silently inheriting these offsets.

## Catalog and lookup

`FL2GameData::RecipeDataLoad` at `0x1047cea0` names recipe-c.dat. Its binary
record serializer at `0x1045f090` and the independent named text-loader fields
agree on this serialized order:

| Field | Wire data | Native record offset |
| --- | --- | --- |
| Internal alias | String | `+0x10` |
| Recipe index | DWORD | `+0x1c` |
| Recipe item ID | DWORD | `+0x20` |
| Required recipe level | DWORD | `+0x24` |
| Product item ID | DWORD | `+0x28` |
| Product count | DWORD | `+0x2c` |
| MP consumed | DWORD | `+0x30` |
| Success rate | DWORD | `+0x34` |
| Material count | DWORD | `+0x38` |
| Ordered materials | Repeated item-ID/count DWORD pairs | Array at `+4` |

The current original file contains 871 records. Native record `+0` is a cached
**product** ItemData pointer populated after decoding (`0x1047d002–014`), not
another serialized field. Therefore `GetRecipeNameBy2Condition` and
`GetRecipeIconNameBy2Condition` use the product's ItemData name/icon
(`0x10128869`, `0x101289b9`), not the internal alias or recipe-item name. The
book script separately uses the recipe item's name/description and the product
icon.

`GetRecipeDataByIndex` (`0x10478b20`) matches the source recipe index.
`GetRecipeDataBy2Condition` (`0x10478d60`) scans increasing native table entries
and returns the first exact product-ID/success-rate match. There is no nearest
rate or highest-rate fallback. The table is populated by index-keyed insertion;
the allocator behind an erased import has not been bound, so source file order
is not promoted to a universal native table-order rule. The current catalog's
only repeated product/rate pair, 264/60, has identical tree-consumed values in
both records (indices 138 and 436). Conflicting duplicates in another source
must remain unresolved.

The direct material getter emits `(itemId, count)`. Its tree counterpart
(`0x10128cd0`) emits `(itemId, 100, count)` in serialized order: `100` is an
explicit native push at `0x10128dc6`. It is not inherited from the parent recipe
and is not a selected best recipe rate. The source tree uses the returned raw
material quantities; it does not multiply them by parent recipe output counts.

## Packets and ordinary windows

Native packet-table entries bind D6 to `0x10418870` and D7 to `0x10418960`.
Named UGameEngine methods then call NConsole methods which emit the original
script events.

| Packet | Original decoded shape | UI behavior |
| --- | --- | --- |
| D6 | Three-DWORD header, then ordered two-DWORD recipe rows | Event 820 opens/clears the book; 830 adds each first row DWORD |
| D7 | Recipe index, book type, current MP, maximum MP, result | Event 840 populates manufacture and hides the book |
| AC | Book type DWORD | Request book |
| AD | Recipe index DWORD | Delete registered recipe |
| AE | Recipe index DWORD | Request manufacture information |
| AF | Recipe index DWORD | Request one manufacture |

D6's second header field is labeled `CurrentMP` in the native emitted event;
the configured server writes its maximum-MP value there. The book script does
not consume it. Native UI dispatch ignores the second DWORD of each D6 recipe
row; the configured server uses that field as a one-based enumeration. It is
not the identifier for delete/make requests. The gateway may preserve both
fields without substituting the enumeration for the source recipe index.

The original RecipeBookWnd, RecipeManufactureWnd and RecipeTreeWnd script hashes
are checked directly from Interface.u. Their relevant behavior is:

- Book arrival shows/focuses the book, but does **not** hide manufacture. Book
  type 1 uses system-string title 1214; the other branch uses 1215. Capacity
  comes from event 2070's separate recipe/dwarvenRecipe fields.
- A book double-click requests AE. Delete reserves the row's recipe index and
  requires the owned warning dialog's OK before AD.
- D7 hides the book, populates manufacture and updates the MP/material data.
  Result 0 uses system message 960; result 1 uses 959; other values leave the
  result text empty. A request/info status is not a successful manufacture.
- Make sends AF and leaves the window open. Prev requests AC and closes
  manufacture. The tree button toggles the tree and supplies event 810 with
  the recipe index and success rate.
- Material inventory changes refresh matching ingredient availability. The
  source does not use missing materials as a client-side prohibition on AF;
  the server determines the result.

The manufacture/tree titles also exist in XDAT; their absence from an older
export was a parser gap. XMLWindowData serializes four strings after the common
control suffix, then its eighth DWORD is title field `+0xe4`. The named title
setter/getter and Create path (`0x100f4357`, `0x100f10b5`, `0x100f2292`,
`0x100f3a26`) pass this system-string ID to the runtime window. Explicit IDs are
663 for RecipeManufactureWnd and 662 for RecipeTreeWnd. RecipeBookWnd initially
has 663, which its script replaces as above. This does not resolve arbitrary
inherited title sentinels or certify inherited frame chrome.

## Ingredient tree and names

Fresh native tree nodes initialize expansion field `+0x1c` to zero
(`0x1006c2cb`); the container root is explicitly set to one (`0x1006c910`). Thus
the fresh invisible root is expanded and its product node initially collapsed.
A separate saved-name restoration path can change expansion; its broader
policy is outside this proof.

The original DrawNode path at `0x1006ca90` adds node offsets to its supplied
origin. A visible button advances the first content cursor by button width plus
button X offset. A text line break resets to **node origin before the button**
plus the item's X offset (`0x1006ceec`). A blank item flushes the current line,
then adds its own height (`0x1006cf12–21`). Expanded children recurse from the
same node X origin and accumulated Y (`0x1006d188–1a3`). These distinctions
prevent carrying the 12-pixel button reservation onto every text line or every
child. The recipe script supplies the icon/button/blank dimensions and offsets;
the shared training-tree evidence covers the ordinary item-flow subset. Exact
native font measurement and all saved expansion behavior remain separate.

The private miner retains qualified original identities for the tree textures.
The script's shortened `Default.ChatBack` reference is resolved for export only
by a unique package/leaf match to `Default.Icon.chatback`; the original native
texture resolver's equivalence for that shortened spelling is not proved.
That resolution is labeled in metadata rather than presented as native lookup
behavior. TreePlus/TreeMinus source images are 16×16 while the script's button
rectangle is 12×12. Recovered rectangle dimensions alone do not determine
whether the original draw path crops or scales the texture; current browser
sampling of those controls is not certified by this evidence.

`MakeFullItemName` calls the original ItemName and AdditionalName getters. A
null additional-name pointer or the native `NAME_None` sentinel returns the
base name. Other returned additional names use a hyphen with no added spaces
(`0x10146560`). The protected getter's conversion of an **empty DAT string**
to those return values is not established: the browser may admit the proven
nonempty join but must not claim the empty-string case was recovered.

The source grade formatter returns tokens `graded`, `gradec`, `gradeb`,
`gradea`, `grades` for valid grades 1–5. Below 1 it returns no token; other
positive values are not admitted by this bounded table proof. Recipe grade
comes from the cached product ItemData and its item-type-specific crystal-type
field (`0x10128149–16c`). The source script surrounds grade tokens with its
own markup. Browser text/grade art is not implied by recovering those tokens.

## Recipe shortcuts

The original RecipeItem drag branch matches that control name at
`0x100484e8`, requires a positive control ID, and constructs
`[type=5, room, ID, ordinary-character-type=1]` before the ordinary registration
call (`0x10048521–54`, `0x10048670`). The book script supplies the source recipe
index as ServerID and marks the row as recipe shortcut type.

The matching type-5 use branch reads the same native ID field `+0x1e58`
(`0x10171625–33`) and calls NetworkHandler slot `+0x394`, whose exported identity
is RequestRecipeItemMakeInfo. A recipe shortcut therefore opens information
through AE; it does not directly request AF. This is the ordinary RecipeItem
path, not a proof of every alternate drag source, pet shortcut or optimistic
widget update. See [native shortcut evidence](native-shortcut-evidence.md) for
the existing 0x33/0x35 transport proof.

Both native register/full-list recipe branches call the exported GL2Console
pointer (`0x10c5103c`), slot `+0x2d4`, which maps to NConsole's receiver at
`0x1016f540`. Its five-case table at `0x1016fb90` routes type 5 to
`0x1016fa44`. After the exact recipe-index lookup, the receiver passes
`recipeItemId` (`+0x20`) to the named GetItemName helper (`0x1016fa70–77`),
and `productId` (`+0x28`) to GetIconName (`0x1016fa8c–93`). The helpers read
ItemData's name `+0x50` and icon `+0x3c`, respectively. Consequently a recipe
shortcut's label names the recipe item while its icon shows the crafted
product. This presentation binding is preserved explicitly as
`native.recipeShortcut.name = recipeItemId` and `icon = productId`; neither
display field is the internal recipe alias.

The browser now permits ordinary type5 registration from a received book row.
The drag payload carries the recipe index; neither the book ordinal nor an item
ID can replace it. Binding state changes on server echoes. Restored recipe
shortcuts use the same source presentation and request AE details even before
opening a book. They do not send AF, learn a recipe, or infer eligibility from
the recipe catalog. Unavailable source presentation remains unavailable.

The pending detail request is independent of an already open recipe's result:
an in-flight A result cannot consume a later shortcut request for B. Session
reset and window closure still retire pending replies. Portable state/UI/wire
tests cover these cases. The offline inspector additionally accepts explicit
shortcut snapshots and clearly labels local registration/deletion echoes as
UI fixtures, with no server persistence claim.

Visible browser checks passed real mouse book→slot registration, click/F1→AE
details, ingredient-tree expansion, right-click deletion echo and inactive
deleted slots. A restored explicit shortcut snapshot opened manufacture with
no preceding book. The browser sometimes delivers dragenter immediately before
drop without another dragover; both events now accept the copy operation. The
Elbera inspector preserves a bounded visible drag-event receipt. This is a
browser event adaptation, not an invented game delay or optimistic binding.
Live reconnect still restores the actual character's existing non-recipe
shortcuts and Common Craft opens its empty0/50 book. No successful live craft
or recipe-shortcut persistence is claimed.

## Remaining scope

Original extraction and source-backed UI transitions do not certify a live
craft result. Registered recipe availability, material consumption, MP changes,
success/failure and reconnect persistence still require observed server events.
Public recipe shops, inherited frame/font/tint details, conflicting native
lookup duplicates, saved tree expansion policy and the protected empty-name
helper remain explicit limits. Source UI sounds depend on the separate audio
evidence and must not acquire guessed playback parameters here.

## Browser and configured-server checkpoint

The existing ordinary character's Common Craft skill opens the received
empty General Recipe Book with0/50 capacity. Separate read-only Elbera
playtest queries received both empty books and recipe1 information with
current/maxMP74/74 and result−1. This does not establish recipe ownership.
No recipe grant, class change, manufacture or deletion was performed live.

The current human's Bow recipe item1788 is the configured dwarven recipe4;
Common Craft does not make it learnable. The configured level1 common Potion
recipe6926/index686 needs Fish Oil6908×2 and30MP; Antidote6929/index689 and
Bandage6931/index691 each need the same oil and45MP. These formulas match the
decoded original catalog, but acquisition is a separate server concern.
Their non-GM shop entries in this datapack belong to owner-only clan-hall
services. No immediate solo purchase/drop route was found for the current
level6 character. A detail response is not proof of a usable recipe.

A normal new Dwarven Fighter has an evidence-backed later target: learn
Create Dwarven Craft at level5, then obtain Recipe: Wooden Arrow1666 and its
materials. One concrete configured path uses level10 Spoil/Sweeper against
Utuku Orc Grunt20448; nearby Utuku Orc20446 can drop Stem1864 and Iron Ore1869.
Recipe1 consumes four stems and two ores for500 Wooden Arrows17 at30MP and
100% source success rate. The relevant configured files are
`data/xml/classes/dwarfFighter.xml`, `data/xml/recipes.xml`,
`data/xml/npcs/20000-20999.xml` and `data/xml/spawnlist/23_12.xml` under the
datapack. This is a progression target, not a completed playtest or an assumed
number of kills. AutoLearnSkills remains enabled; manual trainers remain
supported. No grants, class mutation or rate changes were made.

The Elbera browser replay uses the unchanged actual detail, capacity and
inventory values plus one visibly labeled, manually constructed selection
row. Item Creation and Recipe Information show the decoded output, MP cost,
success rate and ingredients. Expand/collapse, Create request, Back,
independent tree Close, and Warning74 Cancel/Confirm were exercised through
visible controls. Requests stayed offline; the source row and inventory were
not optimistically changed. Earlier missing-art and hidden-window position
errors were fixed and the final replay produced no new console errors.

The runtime keeps book ordinals distinct from recipe indices; updates MP and
material counts without replacing unrelated controls; and retires pending
details/confirmation context on replacement, close or disconnect. Complete
original ItemWindow badges, selection/tint, grade glyphs, font metrics and
frame rendering remain unfinished. Ordinary recipe shortcuts are connected;
their live acquisition/registration/reconnect path still needs a character
with an eligible learned recipe.
