# Original class-default boundaries

Elbera Tools now locates supported Interlude `UClass` default properties by
reading the serialized class prefix. The world exporter uses this path for
Actor, StaticMeshActor and the complete LevelInfo ancestry. It no longer
searches for a plausible terminal property stream for these inputs.

This matters for movers: two starts, one byte apart, can both look like valid
declared properties. In the pinned `Engine.Mover`, offset **738** begins the
original stream; **739** begins inside a compact name index and misreads
`RangeHeight` as `CollisionHeight`. The serialized prefix identifies 738
without comparing the resulting values or choosing whichever looks plausible.

## Reader contract

`tools/l2lib/classdata.py` exposes `read_class_default_prefix(package, export)`.
It requires file version **123**, a `Class` export without `RF_HAS_STACK`,
matching export/superclass identity, canonical compact indices and bounded
table references. All reads stop at that export's end. Unsupported versions,
tokens or malformed prefixes fail; there is no fallback scan.

The reader retains the six initial fields, line/text positions, serialized
script tokens, state scalars, class flags, four-word field, dependency records,
name arrays and final reference/name fields. Fields whose meanings have not
been independently bound retain their original native offsets as labels.
It reports the relative default offset and source spans/hashes. It does not
parse the default properties or construct a live class object.

The script's declared size describes its **native memory buffer**, not its
saved byte count. For example, Mover's script occupies 13 memory bytes but 10
saved bytes: saved compact object references expand to four-byte references.
The iterative expression walker follows supported original serializer paths:

| Token bytes, hexadecimal | Serialized operands followed |
| --- | --- |
| `08 0b 16 17 25 26 27 28 2a 2d 30 31` | None |
| `00 01 02 29` | Compact object reference |
| `13 2e` | Compact object reference, then one expression |
| `09 18` | Two-byte word, then one expression |
| `24 2c` | One byte |
| `39` | One byte, then one expression |
| `70..ff` | Argument expressions through token `16` |

This list describes serialization shapes, not gameplay meanings. Other token
paths are unsupported. The reader neither executes expressions nor interprets
replication conditions, and imposes no invented recursion-depth game rule.

`serialized_defaults` in the existing NPC-data module validates default tags
at this exact boundary against inherited declared property types and the exact
export end. Its legacy value decoder does **not** retain array indices; array
consumers must use ordered tags instead. Other NPC/character paths still using
terminal-stream search remain provisional and are not upgraded by this change.

## Original source binding

| Input | SHA-256 |
| --- | --- |
| Owned Core.dll | `9462f87a5e77d21865e2e00264efd44df25feb47aa78f8a72e9cf66ce4e919bf` |
| Comparison Core.dll | `d83449b1cdf0ac717a98be9289caab03cb507324a696ef449e31369e28416639` |
| Owned Engine.u | `9b04ff5cb4258e84dfa8efbdd85d9121f3bdcb5822a9a21ca69d200d05a69761` |
| Owned Core.u | `de5f0ee0a773327bce13c96622fd3c654cff7db88b9be065d1232590c140fda0` |
| Owned GamePlay.u | `714639cdad265a7caeaf0f91ce76bb50492390eaa3faea15ed5a28a3e830b64a` |

`qualify_class_default_prefix` extends the existing native class-registration
check. Twelve retained body ranges match the pinned comparison Core byte for
byte. Named exports and seven thunks bind the expression/dependency serializers;
28 instruction anchors bind consumed fields, memory increments and array calls.
The matched jump/index tables at `10132148..10132212` independently check the
supported token groups against the Python reader's sets.

| Serializer | Original addresses, exclusive end |
| --- | --- |
| UObject | `1015e820..1015ea8f` |
| UField | `10131210..10131287` |
| UStruct | `10131450..1013158b` |
| UState | `101316e0..1013176d` |
| UClass | `101351c0..10135425` |
| UStruct.SerializeExpr, normal path | `10131b90..10132108` |
| Four-word field | `10130dc0..10130e30` |
| Dependency array / record | `101342f0..101343a6` / `10131b40..10131b77` |
| Name array | `10132470..10132526` |
| Object / script-reference archive wrapper | `1012a9f0..1012aa01` / `10130f10..10130f21` |

The enclosing registration check retains the earlier initial-field, version
gate and state-prefix bindings. These are source correspondence checks, not
native execution of complete archive factories, linking, class construction or
configuration. Supplemental correspondence does not authenticate its archive.

## Reproduce and inspect

The portable parser tests use authored bytes only and run without a client:

```sh
python3 tools/l2lib/tests/test_classdata.py
python3 tools/release/smoke_core.py
```

The standalone **Elbera Tools Core source build** includes this reader and its
portable tests. The existing published Core 0.1.0 archive retains its original
contents. Put the kit's `tools` directory on your Python import path:

```python
from l2lib import load_package
from l2lib.classdata import read_class_default_prefix

package, _ = load_package('/path/to/your/Engine.u')
export = next(e for e in package.exports
              if package.class_name_of(e) == 'Class'
              and package.export_name(e) == 'Mover')
prefix = read_class_default_prefix(package, export)
print(prefix['defaultsOffset'], prefix['script']['memoryBytes'])
```

Original-input checks require the **full repository**, owned packages/maps,
the pinned Engine/Core edition and comparison files, Capstone 5.0.7 and Node:

```sh
python3 tools/ui/check_static_actor_bounds_native.py \
  --comparison-engine /local/comparison/engine.dll \
  --comparison-core /local/comparison/Core.dll --check
python3 tools/world/check_static_collision_records.py 17_25 22_22 --check
```

Omit `--check` on the record checker for the local `savedActorClasses` receipt:
source package fingerprints, each class and exact parent, prefix fields and
hashes, byte-for-byte prefix reconstruction, and ordered default tags including
array indices. The two-map census covers **26 distinct classes and ancestors**.
Round trips check lossless retention; the original serializer bindings supply
the layout evidence. Neither alone is proof of complete client loading.

Saved/default data is not current actor state. Mover motion, brush/volume
collision dispatch, level startup and live world queries still require their
own source recovery and integration. This change does not repair map rendering
or claim a playable, fully faithful client. Original inputs and raw receipts
remain private and are excluded from source/tool releases.

## Saved actor flags in the world loader

The full-repository world exporter now follows each actor's exact class ancestry
to recover the **82 declared Actor Boolean fields** used by the collision
components. Their original four word layouts are shared with the existing
typed-copy/property evidence. Only their declared masks become known; padding
is not filled in. Missing declared defaults use the separately qualified
zero-plus-parent class-default path. Each field retains the class that last
overrode it, or its explicit zero-initialization origin.

The reader rejects cyclic or unrelated ancestry and subclasses redeclaring a
consumed field. It retains ordered map overrides, including repeated tags,
the exact saved frame, the property-stream span and any opaque native tail.
Each map's TerrainInfo has a **262,773-byte** tail after its properties; this
record hashes that tail without interpreting or discarding it.

The source bundles contain **1,237** Boolean records for Talking Island and
**2,406** for Giran. Talking Island's count includes three static exports absent
from the saved actor array. The **3,640 saved actors** have these true saved
`bCollideActors` values; these counts are not current collision membership:

| Class | Talking Island | Giran |
| --- | ---: | ---: |
| StaticMeshActor | 951 | 1,891 |
| WaterVolume | 1 | 8 |
| BlockingVolume | 3 | 13 |
| MusicVolume | 12 | 16 |
| Mover | 0 | 10 |

`check_static_collision_records.py` independently reads final Boolean values
with the generic packed-property decoder, checks the retained prefix and source
spans, rereads ordered tags and origins, and runs the complete bundle through
the actual browser source-loader module. The commands above exercise this
path. Deliberately changed bits, ancestry, origins, stream hashes, tail spans
and tag order are rejected in local original-input checks.

`prepareStaticWorldSource` preserves the verified subset as
`actorForReference(ref).savedGroups`. It is separate from `prepared` actor state;
unimplemented classes remain unprepared. Older bundles without these records
retain an unresolved subset, rather than invented false flags. Updated private
bundles are connected to the actual scene loader. Offline Giran reports all
2,406 saved Boolean records and still reports collision unavailable.

The native registration checker also binds **32 virtual slots across eight
native actor classes** in the pinned Engine copies. Mover has its own PostLoad;
brush and volume classes use ABrush.PostLoad and ABrush.GetPrimitive. These are
method-identity checks, not execution of those subclass routines. They prevent
silently treating the existing static-prop lifecycle as suitable for every actor.

This world extraction/verification remains a full-repository tool; the standalone
Core preview includes the class-prefix decoder, not the world exporter. Complete
subclass construction, PostLoad, primitive providers, startup and live queries
are still required. No map rendering or Online movement repair is claimed.

<a id="linked-scalar-property-offsets"></a>

## Linked property offsets

The saved export table is not property iteration order. The declaration
inspector now reports `fieldChain` separately from its existing `fields` array.
It starts at the class's serialized child reference, follows each UField's
`Next`, includes intervening functions/states and stops before a foreign owner.
Cycles, imported links, nonempty tagged headers and unknown kinds are explicit
errors. Each bounded prefix has its own source hash; reading a function link
does not decode or execute that function's remaining body. Nested structures
now retain the same separate chain. Their bounded child-prefix reader consumes
the empty tagged terminator that Classes bypass and checks the saved superclass
against the export table; it does not interpret the rest of the structure body.

`l2lib.propertylayout.property_offsets` implements only the original class/struct
offset stage. Inputs are properties in that linked order and a supplied
parent `PropertiesSize`. It preserves byte packing, four-byte scalar alignment,
twelve-byte string headers and packed Boolean offsets/masks. A Boolean after
another Boolean can reuse its word even when a static array dimension exceeds
one; the native branch does not test `ArrayDim == 1`. After bit 31, the next
Boolean starts a new word. Unknown kinds, nonpositive dimensions and arithmetic
outside the admitted nonwrapping signed range fail without a guessed layout.

StructProperty requires the referenced structure's prepared size. The original
alignment is two for size two, one for sizes below four otherwise, and four for
larger sizes. It is not inferred from a field or structure name.
`structure_layouts` resolves a complete decoded graph, following both structure
inheritance and nested-property references. It rejects cycles, missing targets,
duplicate identities and incomplete/inconsistent field chains. The sixteen
structures reached by the current volume declaration corpus resolve this way;
there is no hardcoded Vector/Color/Matrix size table.

The original Core comparison binds these ranges (exclusive ends):

| Routine | Range | Scope |
| --- | --- | --- |
| `UStruct.Link` | `10135e30..10135f12` | Recompute-offset prefix; deliberately stops before property lists |
| `UByteProperty.Link` | `10170af0..10170b4b` | Complete ordinary body |
| `UIntProperty.Link` | `10170d40..10170da1` | Complete ordinary body |
| `UBoolProperty.Link` | `10173250..101732f1` | Complete ordinary body |
| `UFloatProperty.Link` | `10171510..10171571` | Complete ordinary body |
| `UObjectProperty.Link` | `10171630..101716b6` | Complete ordinary body; ClassProperty shares its dispatch |
| `UNameProperty.Link` | `101719f0..10171a51` | Complete ordinary body |
| `UStrProperty.Link` | `10171c10..10171c83` | Complete ordinary body |
| `UArrayProperty.Link` | `101721d0..10172263` | Complete ordinary body; inner Preload/Link precedes header layout |
| Array owner size getter | `101305c0..101305c3` | Original UField zero-size dispatch inherited by UArrayProperty |
| `UStructProperty.Link` | `10172690..1017273d` | Complete ordinary body with supplied completed Preload |
| Property and Boolean casts | `10132a00..10132a22`, `101329d0..101329f2` | Complete bodies over supplied reflection |
| Size, parent and packing getters | `1010b310..1010b314`, `10115a20..10115a24`, `1010b570..1010b576` | Complete bound UClass dispatch bodies |
| Structure parent and packing getters | `10115950..10115954`, `101305d0..101305d6` | Complete bound UStruct dispatch bodies |

The existing class-prefix and property-declaration qualifiers bind saved
child/Next serialization. Additional nonproperty serializer prefixes establish
their first inherited call, with exact ranges/hashes retained in the local
receipt. Loading `UStruct.Serialize` passes `1` to virtual Link; the bound
UClass → UState → UStruct calls forward that argument. This source comparison
does not execute the complete serializer, UState/UClass Link or archive I/O.

The interpreter executes **420 authored cases: 227,311 instructions across 432
addresses**, including padding, scalar/static-array sizes, skipped nonproperty
fields, Boolean rollover, static Boolean arrays, nested alignment and root
structures with no superclass. Archive Preload is an
explicit successful, already-completed provider. Current parent size and
reflection are supplied; original casts and property virtual calls execute.
Python compares offsets, element sizes, masks and final size, not property-flag
changes or cleanup/reference lists. The interpreter stops mid-method at the
documented boundary and does not report a full Link return.

The optional original-input check adds **five class cases: 5,281 instructions
across 398 addresses**, and **sixteen structure cases: 4,163 instructions across
391 addresses**, using the pinned Engine/Core/GamePlay packages. Volume,
BlockingVolume, MusicVolume and PhysicsVolume totals match their separately
qualified native registration sizes. Volume's `LocationName` offset agrees with
the original constructor's string no-init call. WaterVolume's own fields use the
explicitly supplied native PhysicsVolume parent size. Nested sizes are derived
from the saved graph and each structure's offset stage is also compared with
original instructions. This does not certify complete parent reflection or
admit any saved volume to live world startup.

Inputs use the Core fingerprints documented above and the Engine/package
fingerprints in [the volume evidence](native-static-actor-bounds-evidence.md#volume-construction-and-property-declarations).
No client bytes or original declaration payloads are bundled with the tool.
Private-data reproduction from the full repository:

```sh
python3 tools/world/inspect_actor_declarations.py --structure-layouts --check
python3 tools/ui/check_property_layout_native.py \
  --comparison-core /local/reference/system/Core.dll \
  --comparison-engine /local/reference/system/engine.dll \
  --original-volumes --output tmp/local-property-offsets.json
```

Omit `--original-volumes` and `--comparison-engine` for only the authored
native cases; those still need the two pinned Core images and Capstone.
The portable fixtures require neither original files nor Capstone:

```sh
python3 tools/l2lib/tests/test_declarations.py
python3 tools/l2lib/tests/test_propertylayout.py
python3 tools/release/build_core.py --check
```

Current standalone Core source builds include the reader/helper and portable
fixtures, now including the metadata helpers and string reader below: **25 selected files / 81 checks**. The full native verifier and world
inspector remain full-repository tools. Existing published ZIPs are unchanged.
Complete default initialization, configuration, actual parent-class offsets, complete class
loading and volume/world startup remain outstanding; no map repair is claimed.

### Array inner linking

The declaration tree reader follows the exact saved inner reference and requires
that local export's owner to be the ArrayProperty. It retains each inner's own
source hash. Imported/missing inners, foreign ownership and malformed records
fail; the existing single-record reader remains available for inspection.
The twelve Actor arrays reach three additional structures, bringing the current
corpus to **eight classes, sixteen structures, 364 own declarations and twelve
array inner declarations**. Inner records stay out of the class child list.

Original `UArrayProperty.Link` preloads its inner and calls its virtual Link with
a null preceding property. The array's inherited size getter returns zero, so
inner offsets start there and Boolean masks start at one. Only after inner linking
does the outer receive element size twelve and a four-byte-aligned owner offset.
The outer retains its flags, adding `0x400000` unless `0x1000` is set. Inner and
outer flag changes remain separate. The verifier executes those complete bodies
and the original zero-size/packing dispatch; it supplies only completed Preload
and explicitly prepared referenced metadata.

**552 authored array cases** compare nested layouts: **225,824 instructions at
484 addresses**. Full flags/lists also pass: **551,504 / 681** in the narrower
profile, **717,104 / 891** with the native replication-map lifecycle. Coverage
includes every admitted inner kind, nested arrays, static dimensions, structure
alignment/cleanup inputs, independent Boolean masks, flag preservation and exact
Preload order. Inner flags are checked separately from the outer's lists.

With `--original-volumes --property-lists`, twelve source arrays undergo **42
offset comparisons: 7,990 / 277** in three authored parent-size contexts. Ten
have known consumed flag dependencies; their **30 full-list comparisons** pass
(**13,952 / 448**, or **22,952 / 658** with `--replication`). The other two need
qualified Material/NSkillProjectile class bits. Both possible consumed-bit inputs
are tested for offset invariance; neither is declared to be the actual source
flag. These are **not actual Actor offsets**, complete class initialization or
live volume admission. Native/saved parent reflection and preserve-offset mode
remain explicit next investigations.

The existing commands above include these checks; there is no duplicate tool
or new private input bundle. Thirteen declaration and twenty-one layout/metadata
portable tests are included in current standalone Core source builds. No original
records, DLL bytes or local receipts are bundled. All previous screenshots and
published ZIPs remain unchanged; no browser visual change is claimed.

## Linked property flags and lists

The offset API above is unchanged. Three separate helpers now retain the next
consumed metadata: `property_link_flags`, `property_lists` and `structure_links`.
They preserve the saved flag word separately from changes made by the original
Link methods. String fields add `0x400000` unless `0x1000` is set. Structure
fields use the referenced structure's current `+0x78` list. Object/Class fields
use the original property-bit short circuit or the referenced class's current
`0x200000` bit. None of these operations clears an already-set bit.
Missing referenced-class state is unresolved, never a default zero.

The list helper consumes the original property iterator order, including parent
structures after own fields. Same-named inherited fields retain distinct
qualified identities. The keys name original head offsets:

| Head / property next | Included fields |
| --- | --- |
| `+0x6c` / `+0x64` | Object/Class, Struct, Array and Delegate properties |
| `+0x70` / `+0x58` | Every iterated property |
| `+0x74` / `+0x5c` | Current property bit `0x4000` set |
| `+0x78` / `+0x60` | Current property bit `0x400000` set; consumed by InitProperties' specialized-copy loop |

The verifier's `--property-lists` mode compares the **complete ordinary
UStruct.Link body, `10135e30–10136218`**, reuses the localization iterator and
StructProperty cast, and adds original Object/Array/Delegate cast bodies at
`10132a30–10132a52`, `10132a60–10132a82`, `10132a90–10132ab2`.
Named descriptor exports and virtual property Link dispatch are checked against
the same pinned Core pair. **155 authored cases pass: 403,340 instructions at
632 addresses**, comparing offsets, updated flags, inherited list order and
null termination. The interpreter returns through the original method epilogue
and checks stack/SEH/nonvolatile registers. Empty ancestors, skipped functions,
arrays/delegates in supplied parent metadata, preserved unrelated bits and both
string/structure flag gates are included. Eight cases supply only a known
referenced-class bit to the portable helper while the original instructions
receive independent complete words with varying unconsumed bits.

Without the additional `--replication` option below, this execution profile
admits game-mode fields without replication bit `0x20`, or the original editor
branch that skips grouping. Its temporary map remains empty; map construction,
emptying and destruction are explicit providers in that narrower profile.
Current reflection, parent metadata and completed archive Preload remain
supplied. A full UStruct return is not full UClass/UState linking or live class
initialization.

With `--original-volumes`, all sixteen original structures additionally match:
**12,986 instructions at 583 addresses**, including PointRegion after the
referenced-class recovery below. The existing offset-only comparison still
resolves and tests all sixteen structures. No missing flags are inferred from
names or an older agent's assumptions.

```sh
python3 tools/world/inspect_actor_declarations.py --structure-links --reference-flags --check
python3 tools/ui/check_property_layout_native.py \
  --comparison-core /local/reference/system/Core.dll \
  --property-lists --original-volumes \
  --comparison-engine /local/reference/system/engine.dll \
  --output tmp/local-property-lists.json
```

The Core, Engine and package fingerprints above apply. Full inspector output
contains original metadata and should stay private; `--check` emits a compact
summary. The portable library and twenty-one authored layout/metadata tests are
included in standalone Core source builds. No browser UI or world startup
changes accompany this component; the current tool screenshots remain valid.

### Referenced-class consumed-bit recovery

`UObjectProperty.Link` reads only class bit `0x200000` at original instruction
`10171688`. The qualified native UClass constructor adds `0x12`; Register
inherits only mask `0xf86ec`. Neither can alter the consumed bit. The source
reader therefore compares the native registration word and saved class word,
where one exists, retaining only their agreed consumed bit. It never chooses a
convenient full current word. Saved prefixes use the existing bounded class
reader, including nonzero scripts, with exact package hashes and parent checks.

The pinned source yields seven profiles: Engine.Actor, PhysicsVolume, Sound,
ZoneInfo, Info, DecorationList and Core.Class. Sound and Class have no saved
class export in the pinned packages; their profiles explicitly retain only
native evidence. All seven agree on a clear consumed bit. Other current flags
remain unknown. Source variants, registration ranges, saved-prefix fingerprints
and source hashes are retained in the private receipt.

The existing registration qualifier now also covers these native prefixes:

| Descriptor | Original registration prefix |
| --- | --- |
| Engine.ZoneInfo | `1083bbe0–1083bc54` |
| Engine.Info | `1083cc60–1083ccd4` |
| Engine.DecorationList | `1084a3d0–1084a444` |
| Engine.Sound | `1083f800–1083f872` |
| Core.Class | `101c0390–101c03e3` |

Engine operands and erased imports are bound individually to the pinned
comparison's named symbols; Core's prefix matches byte for byte. The native
UClass constructor, Class/State descriptors and consumed instruction are
checked explicitly. Existing Actor/PhysicsVolume qualification is reused.
No DLL is executed. The verifier runs every available source variant through
both ObjectProperty and ClassProperty: **24 cases, 7,800 instructions at 247
addresses**. These supplement the authored positive/negative-bit comparisons.

`--reference-flags` is optional and requires `--structure-links`, the pinned
owned Engine/Core DLLs and packages, and Capstone. Without it the inspector
retains its package-only behavior: fifteen ready structures and unresolved
PointRegion. With it all sixteen are ready. The API accepts a known-bit
`{mask, value}` pair and rejects unknown consumed bits or values outside the
mask. Portable tests also check disagreement and nested dependency propagation.

This proves the consumed bit for ordinary native registration/saved loading of
these pinned descriptors. Custom classes, external mutations, complete current
class words, UClass/UState replication tables and CDO configuration/localization
remain outside this component. It does not enable live volume admission.

### Game-mode replication grouping

`read_class_script` now retains each token's native `memoryOffset` and exclusive
`expressionEnd`. The same iterative walker handles nested expressions and
argument terminators; a second parser is not introduced. The materializer
expands decoded operands with **explicit current reference DWORD bindings**.
A saved package index is never treated as a runtime pointer. The supported token
set is unchanged: unknown tokens, including debug records, remain unsupported.

The verifier's `--script-expressions` mode interprets original
`UStruct.SerializeExpr` with the complete original base FArchive constructor,
byte/word/reference wrappers, no-op serializers, Tell and Seek. It follows the
original native-call lookahead and cursor rewind. **80 authored scripts / 158
expression entry checks pass: 15,683 instructions at 202 addresses**. Saved vs
loaded reference widths, positive/negative/null indices, nested calls, argument
terminators, trailing roots and preserved loaded bytes are covered.

With `--original-volumes`, five original volume-class scripts are inspected.
Four are empty; PhysicsVolume contains **19 saved bytes / 24 loaded bytes**.
All eleven expression entry points match: **2,851 instructions at 183
addresses**. These comparisons use explicit authored opaque values for source
reference identities. They prove cursor traversal, not the actual object loader
or current live pointer values. Original bytes and local receipts remain private.

`replication_links` groups fields by the byte sequence of their loaded
replication expression. It retains the **last encountered field** as each group's
representative. This matches the original loop at `1013605b–10136185`: initialize
the current field's `+0x68` to itself, determine the end cursor, then update each
earlier matching field. Equal saved bytes are insufficient when resolved
references differ; different saved indices may match when their loaded bindings
are identical. Missing owning-class scripts or unsupported expression offsets
fail explicitly. This comparison does not evaluate the script's truth value.

`--replication` requires `--property-lists` and includes the script checks. It
executes original owner lookup, expression traversal, byte comparison, temporary
map initialization/set/find/rehash/empty/destruction and array growth/removal.
The existing interpreter is reused. Allocation, reallocation and free are
successful supplied providers; reallocation deliberately moves storage. There
is no Python substitute for the native map or grouping loop in this mode.

| Bound dependency | Original body, exclusive end |
| --- | --- |
| UField.GetOwnerClass | `101311f0–10131209` |
| appMemcmp | `1012d910–1012d99e` |
| Temporary map set / find | `10134440–101344b1` / `101325e0–10132634` |
| Temporary map append / rehash | `10132720–101327bb` / `10132650–101326eb` |
| FArray.Realloc / Remove | `101522e0–10152346` / `101523c0–10152437` |

The qualifier additionally records the complete map lifecycle bodies, named
exports where available, constructor/virtual bindings and thunk targets.
Anonymous map helpers are identified by their matched bodies rather than
invented export names. Every retained range matches the pinned Core pair.

**51 grouping cases pass: 3,242,700 instructions at 984 addresses.** Coverage
includes equal/different expression bytes (including trailing-byte differences),
reference aliases across owning
classes, empty ancestors, nested outer lookup, nonreplicated and editor-skipped
fields, unsigned offset 65535, hash collisions, array growth and rehashing. All
temporary allocations are released. Full original return, stack/SEH, preserved
registers, property flags, offsets and four lists are checked as well.
The existing 155 list cases additionally pass with native map lifecycle:
**449,840 instructions / 842 addresses**. Sixteen original structures add
**17,786 / 793**; the 24 reference variants add **15,000 / 457**. The narrower
profile's current counts are recorded above.

```sh
python3 tools/ui/check_property_layout_native.py \
  --comparison-core /local/reference/system/Core.dll \
  --property-lists --replication --original-volumes \
  --comparison-engine /local/reference/system/engine.dll \
  --output tmp/local-replication-linking.json
```

Omit the original-volume options for authored cases only. Use
`--script-expressions` alone to select expression checks without grouping.
The portable materializer and grouping helper are included in current Core
source builds: **25 selected files / 81 checks**. Complete class reflection,
UClass/UState replication tables, object resolution, CDO configuration/localization
and actual volume/world startup remain unfinished. No live volume admission,
map repair, browser visual change or complete client parity is claimed.

## Saved string loading and copying

`l2lib.stringproperty.decode_string_property` handles an isolated saved
StrProperty payload. A positive compact count reads bytes and zero-widens them;
a negative count reads little-endian UTF-16 units. It preserves storage units,
including embedded NULs and unmatched surrogates, separately from a first-NUL
text view. The original loader sets count/capacity to the absolute count, then
clears an absolute count of one through `FString.Empty`, even for a nonzero
sole unit. No character-set replacement or guessed text is introduced.

The tool admits bounded, nonoverflowing allocations and terminated strings
(plus the original count-one clearing path). These are **tool admission
conditions**, not claims that the original archive validates malformed text.
Trailing bytes, truncated payloads and compact headers longer than five bytes
fail. The older generic `read_fstring` remains unchanged for its other callers.

The existing localization source qualifier compares complete ordinary Core
bodies, including later saving branches. Exclusive ranges:

| Routine | Range |
| --- | --- |
| `UStrProperty.SerializeItem` | `1016f040..1016f055` |
| `UStrProperty.CopySingleValue` | `10175380..101753dc` |
| FString archive operator | `10155360..101554a9` |
| Compact-index archive operator | `1015cfb0..1015d18d` |
| UTF-16 array byte accounting | `101137e0..101137fe` |
| FString data accessor | `101150b0..101150bf` |
| `appIsPureAnsi` | `1014f6f0..1014f71b` |
| `FString.Empty` | `10115040..10115050` |
| Byte/word archive wrappers | `101307e0..101307f9`, `10130800..10130819` |

The verifier reuses the localization interpreter's byte heap and independently
executes the original compact decoder, loading loop, count-one clearing and
single-value copy. It compares complete storage, counts/capacities, old-string
byte accounting, preserved registers and same-header no-ops in **69 authored
cases**. Inputs include continuation boundaries, byte values above 127,
embedded zeros, supplementary characters and unmatched UTF-16 units. Archive
reads/accounting and successful allocation/memcpy remain supplied providers.
Saving, exceptions, overlapping allocations and provider mutation of source
headers are outside this execution profile.

The declaration inspector's `--string-defaults` option overlays known decoded
tags through saved ancestry, preserving tag order, source class and hashes.
The original corpus has two own string tags and four inherited copies through
five volume classes. Both tags are nonempty; the water class overrides its
inherited value. The optional native comparison checks these saved overlays
using original load/copy routines, with explicit headers and ordering. Untagged
values remain unknown. This source-overlay check does **not** execute complete
CDO initialization, tagged-property acceptance or configuration. A separate
composed check now executes inherited `UProperty.CopyCompleteValue`
(`1016e050–1016e092`, string virtual slot `+a8`) within original InitProperties,
then Volume construction and localized PostLoad. Its 192 cases supply a
string-only specialized-copy list, current class/default state and configuration;
they preserve the source allocations and compare complete browser string values.
Neither check admits the 53 currently unsupported live volumes.

The Core and package fingerprints above apply. Reproduce with the full
repository and caller-owned inputs:

```sh
python3 tools/world/inspect_actor_declarations.py --string-defaults --check
python3 tools/ui/check_actor_localization_native.py \
  --comparison-core /local/reference/system/Core.dll \
  --original-strings --output tmp/local-string-loading.json
```

Without `--check`, the declaration inspector prints decoded values and payloads;
keep that output private. Omit `--original-strings` to skip original package
reads, while still requiring the two pinned Core images and Capstone. Portable
decoder tests need neither:

```sh
python3 tools/l2lib/tests/test_stringproperty.py
python3 tools/release/build_core.py --check
```

The repository's object-localization inspector now shows default copying and
localized PostLoad. Full inputs, Engine fingerprints, command and limits are
documented in the [composed startup evidence](https://github.com/elberacasa/Lineage2Elbera/blob/main/docs/native-actor-localization-evidence.md#default-copying-and-localized-actor-startup).
That verifier and browser page are repository tools, separate from the Core
source kit. Live class setup, configuration and world startup remain open.
