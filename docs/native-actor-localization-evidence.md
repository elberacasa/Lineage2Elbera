# Original object localization

The browser now has a source-bound implementation of `UObject.LoadLocalized`
context selection, inherited/nested property traversal and optional text lookup.
**145 authored cases** match the original control flow: **444,224 interpreted
instructions at 446 addresses**, **1,014 configuration requests** and **923 text
import calls**. No native DLL is executed.

The string path now also executes the original ImportText and assignment:
**145 joined cases**, **616,891 instructions at 572 addresses** and **923 exact
text copies**. Another **76 direct string cases** cover empty values, literal
text, UTF-16 and buffer identity. The browser stores the same text values.

This is a loading component, not completed volume startup. The current map
loader still leaves all 53 volume actors unsupported. Current linked metadata,
configuration parsing and other property importers remain unresolved. Existing
map geometry and terrain defects are unchanged.

## Elbera inspection page

Serve the existing world editor and open `test/actor-localization.html`. It runs
without game files, an account or a server. Choose a placed instance, class
default or nested flagged object; compare found, empty, missing and absent
configuration. The before/after table shows actual browser string storage,
including values retained after missing or empty translations. Every displayed
name, offset and translation is **authored**. The page uses the same browser
module as the native comparison.

![Elbera Tools showing ordered localization requests and property imports](img/elbera-tools-object-localization.png)

This is a complete, unmodified browser capture of the tool. Thirty combinations
of its controls passed, including return to the initial scenario; no page or
console errors were captured. The existing game-test runner also captured and
inspected the page. This is not an official game panel or a gameplay screenshot.

## Recovered behavior

- The current class's `0x20` bit and current editor state gate localization.
- An object with index `-1` uses its class's outer/name. Other objects use their
  own outer/name, except flag `0x100` with a nested outer adds an object prefix.
- The original field iterator follows current child links, filters by the
  field class's property bit, then visits inherited structures. Saved export
  order is not a substitute for that linked order.
- A static array gets `[index]` keys only when its dimension exceeds one.
  Nonpositive dimensions perform no element work.
- A StructProperty recurses **before** the localized-property `0x8000` test.
  Nested localized fields therefore remain reachable through unmarked structs.
- Optional lookup tries the current language, then `int` after a miss. A
  case-insensitive `int` current language does not trigger another lookup.
  A successful empty translation does not import text or try the fallback.
- Before engine startup, or with a known null configuration pointer, the
  original returns the key itself. That is different from a missing entry in
  an available configuration provider.
- Nonempty text invokes the property's virtual `ImportText` with port flags
  zero. The original caller ignores its returned input pointer.

## Source identity and method coverage

| Input | SHA-256 |
| --- | --- |
| Owned Interlude `Core.dll` | `9462f87a5e77d21865e2e00264efd44df25feb47aa78f8a72e9cf66ce4e919bf` |
| Supplemental comparison `Core.dll` | `d83449b1cdf0ac717a98be9289caab03cb507324a696ef449e31369e28416639` |

The supplemental input is the existing pinned archive-2015 comparison. It
qualifies byte correspondence with the owned edition; it does not replace the
owned client as behavioral authority. Both files stay private.

`tools/ui/actor_localization_source.py` compares every byte of these ordinary
ranges and validates named exports, jump thunks, virtual slots and text operands.
Ranges use an exclusive end:

| Method or helper | Owned Core range |
| --- | --- |
| UObject.LoadLocalized | `1015f5e0–1015f6c4` |
| Recursive field worker | `1015f460–1015f559` |
| Property dispatch | `1015c690–1015c73f` |
| StructProperty cast | `101329a0–101329c2` |
| Property iterator constructor / advance | `10119210–1011923e` / `10114340–10114395` |
| UStruct / UClass inheritance getters | `10115950–10115954` / `10115a20–10115a24` |
| Rotating scratch string | `10152570–101525cc` |
| Localize, including the later startup/config-absent return | `10153e70–10153f9d` |
| Current language getter | `1015b9f0–1015ba2e` |
| Formatter wrapper / comparison tail call | `1012e080–1012e09d` / `1012dd00–1012dd05` |
| UTF-16 copy | `1012dd10–1012dd35` |

The later Localize return matters: stopping at its first `ret` would omit the
startup/config-absent branch. Full ordinary ranges are compared even where only
optional lookup is admitted for execution. Exception and unwind paths are not
qualified. Named globals bind editor/startup state, configuration, names,
language and the StructProperty descriptor. Source buffers and code bytes are
not included in the public fixtures or receipts published with this guide.

## Reproduce

Portable checks require Node and Python with Capstone 5.0.7, but no game files:

```sh
node --test editor/world/test/actor-localization.test.mjs
python3 -m unittest discover -s tools/ui -p test_actor_localization_native.py
```

The original comparison additionally needs both pinned private Core images:

```sh
python3 tools/ui/check_actor_localization_native.py \
  --core /private/owned/Core.dll \
  --comparison-core /private/comparison/Core.dll \
  --output tmp/actor-localization-evidence.json
```

The checker loads the source ranges into the existing admission interpreter,
then compares original calls and names with the actual browser module. It
checks stack/SEH restoration and nonvolatile registers, and records source
fingerprints. Cases include scratch-counter wrap, more than 256 sequential
scratch allocations, inherited fields, nested static arrays, Unicode text,
partial writes on lookup misses and all admitted context/gate branches.
Five authored interpreter checks cover partial-word preservation, 32-bit
effective-address wrap, UTF-16/word-register behavior, exact byte allocation
sizes and the compiler stack probe's integer operations. Thirteen browser tests
cover missing metadata, provider failures, partial progress and bounded inputs.
The related browser loader/bounds suites pass too: 66 cases combined.

## Original string imports

`qualify_string_property_text` reuses the same pinned Core images and validates
the UStrProperty ImportText virtual slot and named string/array helper thunks.

| Method or helper | Owned Core range | Coverage |
| --- | --- | --- |
| UStrProperty.ImportText | `10173ae0–10173b3a` | Guarded prefix only: port flag `2` clear |
| FString wide assignment | `10114fd0–1011501e` | Complete ordinary body |
| FArray.Realloc | `101522e0–10152346` | Complete ordinary body |
| UTF-16 strlen | `1012db60–1012db77` | Complete body |
| Compiler stack probe | `1017ece0–1017ed0b` | Complete normal control flow, including page-touch loop |

The ImportText prefix is **not** the whole method: its taken flag-2 branch
enters a later quoted parser. Localization passes zero and takes the admitted
prefix. It assigns the input text and returns the original input pointer.
Whitespace, quotes and backslashes are literal on this path. Copying stops at
the first zero UTF-16 code unit; surrogate code units are preserved unchanged.

FString assignment skips work when the current data pointer equals the source
pointer. Otherwise it obtains the terminated text length, sets count/capacity,
reallocates two bytes per code unit and copies the exact byte count. An empty
assignment requests zero allocation and skips copying. The interpreter's
allocator preserves unknown bytes and supports sizes that are two, rather than
four, byte aligned. It does not round string counts or allocation sizes.

The 76 direct cases execute 24,852 instructions at 127 addresses. They include
36 equal-buffer cases, four empty releases, Unicode/unpaired surrogates, literal
quotes/whitespace, embedded terminators and text up to 1,023 code units. Source
bytes, neighboring guards and nonvolatile registers are preserved, and the
original input pointer is returned. Count/capacity and allocator arguments are
checked independently of the browser value comparison. The joined cases run
the original iterator, lookup, string importer and assignment together; fields
with no import retain their supplied values.

Allocator success and nonoverlapping byte copying remain supplied providers.
The compiler's stack probe executes against explicitly supplied committed stack
words; this does not emulate OS guard faults, failed allocation or SEH handling.
The browser uses immutable UTF-16 strings instead of duplicating the native
heap. It compares the resulting property text, not allocator addresses or heap
capacity. Current string slots and original property dispatch must be known;
missing storage and other property types stay unsupported. Supplied string
slots must have disjoint 12-byte header ranges; partial overlaps or wrapped
relative offsets are explicitly rejected. A shared exact offset is one Map slot.

## Runtime contract and remaining limits

[`actor-localization.js`](../editor/world/js/actor-localization.js) exports
`actorLocalizationContext`, `localizeOptionalText`, `loadActorLocalized` and
`importStringPropertyText`.
The last accepts current `object`, `classInfo`, `isEditor`, `environment` and a
synchronous `importText` provider. Its structure graph must be frozen and use
explicit `super` and `struct` references or null. Fields retain current linked
order, identity, name, classification, dimension, size, offset and flags.
Missing information is unsupported rather than an empty structure or zero.

`environment.readConfig({section,key,filename,capacity})` returns
`{status:'ready', found, value}`. Here `value:null` explicitly leaves the
existing output buffer unchanged; a string writes it, including an empty
string. A failed lookup can still have written text before the fallback.
`readConfig:null` means known absent configuration; undefined means unresolved.

`importText({field,offset,text,portFlags:0})` returns a completion status. A caller
with qualified string-property dispatch can forward the call to
`importStringPropertyText({...call, propertyKind:'StrProperty', storage})`, where
`storage` is a Map of current byte offsets to existing string values. This
updates the supplied slot and returns the stored value. It never invents a slot
for missing source storage. Other property types need their own operations.
Earlier imports remain visible if later metadata or a provider is unsupported.
Providers must be synchronous and nonreentrant; lookup text and metadata must
remain stable during the operation.

The original control-only suite keeps ImportText as a provider. The joined
string suite replaces that boundary with the original string method. Both use
explicit CRT formatter/language-comparison and configuration providers. Thus
the result does not prove native INI parsing, CRT edge behavior or OS allocation. The
browser admits ASCII language identifiers and terminated text below the native
1024-cell scratch capacity. Its conservative filename limit is 255 UTF-16
cells; this is a safety boundary, not a recovered game rule. Relative offsets
must not wrap. Recycling an active nested-prefix scratch buffer is explicitly
unsupported, while ordinary sequential ring reuse is supported.

The [saved declaration census](native-static-actor-bounds-evidence.md#volume-construction-and-property-declarations)
finds only Volume.LocationName localized in the inspected ancestry. That does
not yet prove its current linked offset, configuration context or effects.
Next are current class linking, source string/default storage and configuration,
then the actual volume/world startup join. Existing standalone release ZIPs are
unchanged; this page, module and native verifier are repository Elbera Tools.
