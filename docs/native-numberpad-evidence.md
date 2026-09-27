# Elbera Tools: original NumberPad dialog evidence

This checkpoint reconstructs the supplied Interlude `DialogBox` NumberPad's
geometry, ordinary number operations, edit paint, and English number reading.
It does not certify every native cursor, focus, clipboard, IME, or font-metric
behavior. No native executable is run. Original client files and generated art
remain local; the tools, synthetic tests, addresses, and hashes are reusable.

## Reproduce

From the repository root, with the owner's original files available:

```sh
python3 tools/ui/check_numberpad_native.py --check
python3 tools/ui/mine_dialogbox.py --emit
python3 tools/ui/mine_dialogbox.py --check
python3 tools/ui/build_uiskin.py --dialog-edit-only
python3 tools/ui/build_uiskin.py --dialog-edit-only --check
python3 -m unittest tools/ui/test_numberpad_native.py tools/ui/test_mine_dialogbox.py
```

`test_numberpad_native.py` alone uses only Python's standard library and
synthetic inputs. The miner suite also checks originals when they are present.
Original verification requires the repository's `l2lib`/DAT decryption tools
and Capstone. The skin command decodes exactly three qualified original UTX
textures through `l2lib`, appends only those entries to the existing **1×** skin,
and verifies their decoded RGBA bytes. It never clears/rebuilds the atlas.
Run this narrow command again after a general atlas rebuild, which replaces
the atlas. No AI upscale, painted border, alpha threshold, or guessed crop is
used for these three entries.

Private outputs: `assets/gamedata/dialogbox.json`,
`editor/world/ui/skin.json`, and the three `L2UI_CH3__inputbox*.png` files under
`editor/world/ui/skin/`. The manifest records source package and decoded RGBA
SHA-256, export index, and native crop evidence for each.

## Pinned inputs

| Input | SHA-256 |
|---|---|
| `NWindow.dll` | `af6c3437f3ccf1b26af8b066e0bbd791c7909c94bd3c7d9e3c68c5edcfe059a7` |
| `Core.dll` | `9462f87a5e77d21865e2e00264efd44df25feb47aa78f8a72e9cf66ce4e919bf` |
| `Interface.u` | `5da491d8234863a94bfa1959bcb0be2cd5cdf81110003785436eecc04c86decd` |
| `NWindow.u` | `6f3171147d83e447f2427e249c2ad73428e2b385d1557b86c53effa1062ea791` |
| `Interface.xdat` | `a7969a86d3b676d95cfd42cfd6cd0742c07d7941250dbb63a2ba6d937961c1f4` |
| `sysstring-e.dat` | `33053b17ca8e1d157aec8fb40b4ef8542626338858ce6c7b4d799c7609554135` |

Addresses below are virtual addresses: NWindow image base `0x10000000`,
Core image base `0x10100000`. The verifier rereads package scripts and decrypts
the original system-string DAT; previously generated JSON is not its oracle.
It checks 71 instruction anchors, 15 pinned instruction ranges, 16 executions
of the original integer magnitude loop, and 31 original color-branch cases.
Imported string operations in the bounded interpreter are explicit models of
the independently resolved original Core imports, not native execution.

## Geometry and art

`mine_dialogbox.py` decodes exact XDAT records and named sibling anchors.
The dialog body is 306×128. NumberPad adds 128 pixels on the right, making the
dialog 434×128. Edit record 95038 has rectangle `(75,73,156,17)` relative to the
body. Reading text record 94845 is `(0,57,306,12)`, centered, color `#E4CA7F`.
The ordinary message and buttons keep their source body coordinates.

The pad begins `(306,0)`; its texture is
`L2UI_ch3.Calculate.Calculate1_back`. Its numeric grid starts `(7,7)`, uses
28×28 buttons, and derives successive positions from source sibling anchors.
The All button is `(36,94,57,28)`, Backspace `(94,7,28,57)`, and Clear
`(94,65,28,57)`. These are not evenly spaced layout assumptions.
All 13 first button textures and the pad background already exist in the local
skin manifest. The miner retains all four serialized XMLButtonData texture
fields; mapping every native pressed/hover state is outside this checkpoint.

Native anchor table `0x1005a8cc`, after subtracting one from the enum, establishes
TopLeft 1, TopCenter 2, TopRight 3, and BottomLeft 7. The update subtracts the
self point and adds the named target point plus signed source offsets.
All source dimensions here are integers; no half-pixel rounding is invented.

`NCEditBox::OnPaint` at `0x100183b0` is bound through its original vtable.
It sets the local canvas origin and clips to the edit rectangle, then paints
text at `(2,2)` (`0x10018791..0x10018797`). The draw helper adds these coordinates
to the canvas origin (`0x1002189b..0x100218ae`).

The original creation path `0x10015d09..0x10015d3f` loads
`L2UI_CH3.Etc.inputbox1`, `inputbox2`, and `inputbox3` into three adjacent handles.
The paint path `0x100184aa..0x100185c8` uses source crop `(0,0,8,17)` for each:
left destination width 8, middle width `editWidth−16` starting x=8, right width
8 starting x=`editWidth−8`. Destination height is the edit height. The supplied
source textures are 8×32; using their full padded height would be wrong.
The alternate frame branch uses separately named `_disable` textures; its full
state/lifecycle is not claimed by this three-texture staging operation.

Default text color is `#DCDCDC`. Number mode calls `0x1005a050`, which subtracts
literal comma count from string length. Fewer than five remaining characters
keep the default. Otherwise `(count−2)%4` indexes
`[#FF80FF,#FFFF00,#00FF00,#00FFFF]`. This counts leading zeroes; it does not
parse the quantity. Thus five digits are cyan, six pink, seven yellow, eight
green, nine cyan. The verifier executes the actual source branch/jump table
independently of the reference function.

## Input, grouping, and acceptance

Fresh `DialogBox.uc` from `Interface.u` establishes these operations:

- NumberPad shows the edit, reading text, OK/Cancel, and numeric pad. It selects
  edit type `number` and centers the expanded dialog.
- Digits call `AddString`. All calls `SetString(string(paramInt))` only when
  `paramInt>=0`; Clear calls `SetString("0")`; Backspace calls
  `SimulateBackspace`. `paramInt` starts at 0. It is an All-button input, **not**
  a generic numeric maximum.
- There is no generic initial quantity of 1. The edit clears on hide; a caller
  can set its message. An empty input remains possible.
- OK captures `GetString`, hides/releases the dialog, then emits `EV_DialogOK`.
  No positivity test or min/max clamp occurs in this handler. A specific caller
  owns its conversion and action validation.
- Default action None/Cancel selects Cancel. A caller can request default OK;
  this script branch is not a proof of every keyboard binding.

The XDAT edit suffix is `(1,-9999,-1,0)`. `XMLEditBoxData::Create`
`0x100db2cc..0x100db31f` skips the max-length setter for sentinel −9999; the
native edit constructor initializes explicit max length to zero at
`0x1001a997`. This means no explicit **character-count** limit. It does not mean
the native edit accepts unlimited visible input: when explicit max is zero,
paint stores `measuredTextWidth < effectiveWidth−12` into its acceptance flag
at `0x100186bc..0x100186d4`; later input consults that flag. This is a previous
paint's text-width test, not a speculative pre-insertion clamp. This dialog's
extra-width constructor argument is zero, so the threshold is 144 pixels.
Browser/font-metric parity for this paint-dependent gate remains open.

Named edit type `number` resolves to mode 3. Physical `OnChar`
`0x10018fa9..0x10018fbe` accepts ASCII `0` through `9`, then calls the selection
removal helper before insertion (`0x1001900f`). The IME result path separately
rejects a chunk containing a non-ASCII digit. This does not prove every paste
or composition path.

Native `AddString` `0x10016ea0` appends to pre-caret string `+0x378`, retaining
post-caret string `+0x384`. Unlike physical `OnChar`, it does not call the
selection-removal helper. Pad-button focus changes and selected-range behavior
are therefore not silently equated with browser text-input replacement.
`SimulateBackspace` `0x1012d680` dispatches synthetic message `0x100`, key 8.

`SetCommaStr` `0x100145a0` calls literal grouping helper `0x10062ee0`:
insert commas every three characters from the right without parsing a number.
Leading zeroes survive. Named `GetString` dispatches to `0x10014140`, which
concatenates pre/post-caret strings and removes grouping commas in mode 3.
The returned quantity text is ungrouped. Do not use a floating-point numeric
round-trip, locale formatter, or integer truncation to implement this behavior.

## English reading text

Named `UUIScript::execConvertNumToTextNoAdena` at `0x101001b0` calls
`0x100676e0` with its no-Adena argument set. This is distinct from ordinary
digit grouping. The original English system-string field is ID 1281.
Native language configuration index 1 maps to the script's English enum;
English's native branch uses groups of three. Other languages are not covered.

Core's original IAT bindings identify `FString::ParseIntoArray`, `appItoa`,
`appStrcat`, `FString::operator*`, and `GLanguageType`. `ParseIntoArray` body
`0x101220a0` copies substrings at comma boundaries without trimming them.
The English magnitude labels contain leading spaces after the first comma.
Those spaces must be preserved.

The bounded digit-domain algorithm is:

1. Clear output. Empty input and exact `"0"` produce empty text.
2. If the **original input length** exceeds 12, use literal comma grouping.
   This branch precedes leading-zero removal and short-input validation.
3. Otherwise validate ASCII digits and remove leading zeroes. All-zero input
   produces empty text.
4. Traverse groups of three from left to right. Suppress zero groups and
   leading zeroes within each printed group. Join printed groups with a literal
   comma, with no added space after that comma.
5. Append a literal space and the exact magnitude label to each printed group;
   the units group has no label and consequently retains its trailing space.

For example: `1001` becomes `"1 Thousand,1 "`; `1000000` becomes
`"1  Million"`. A 13-character all-zero string becomes
`"0,000,000,000,000"`, whereas a 12-character all-zero string produces empty
text. These differences are observed source branches, not typography choices.
The 16 original-loop cases include sparse groups, all magnitude boundaries,
and `2147483647`; the public synthetic tests also cover the length-before-zero
branch and integers beyond JavaScript's exact numeric range.

The instruction evaluator covers `0x10067d3d..0x10067e76`, including native
branch order and its explicit string-call contracts. It does not reproduce
unsafe fixed native stack-buffer limits, non-digit long-string behavior, full
localization, or the renderer's glyph metrics. Those limits remain separate
from this supported quantity-dialog contract.
