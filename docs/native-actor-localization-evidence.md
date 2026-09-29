# Original object localization

The browser now has a source-bound implementation of `UObject.LoadLocalized`
context selection, inherited/nested property traversal and optional text lookup.
**145 authored cases** match the original control flow: **444,224 interpreted
instructions at 446 addresses**, **1,014 configuration requests** and **923 text
import calls**. No native DLL is executed.

This is a loading component, not completed volume startup. The current map
loader still leaves all 53 volume actors unsupported. Configuration parsing,
linked source metadata and property text conversion have not been substituted
with fixture data. Existing map geometry and terrain defects are unchanged.

## Elbera inspection page

Serve the existing world editor and open `test/actor-localization.html`. It runs
without game files, an account or a server. Choose a placed instance, class
default or nested flagged object; compare found, empty, missing and absent
configuration. Every displayed name, offset and translation is **authored**.
The page uses the same browser module as the native comparison.

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
Three authored interpreter checks cover partial-word preservation, 32-bit
effective-address wrap and UTF-16/word-register behavior. Ten browser tests
cover missing metadata, provider failures, partial progress and bounded inputs.
The related browser loader/bounds suites pass too: 63 cases combined.

## Runtime contract and remaining limits

[`actor-localization.js`](../editor/world/js/actor-localization.js) exports
`actorLocalizationContext`, `localizeOptionalText` and `loadActorLocalized`.
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

`importText({field,offset,text,portFlags:0})` returns a completion status. It is
the caller's responsibility to perform the real property's operation. Earlier
imports remain visible if later metadata or a provider is unsupported. These
calls are recorded, not a proof of resulting native string storage or field
aliasing. Providers must be synchronous and nonreentrant; lookup text and
metadata must remain stable during the operation.

The interpreter uses explicit providers at the original CRT formatter and
language-comparison boundaries, the configuration virtual call and ImportText.
Thus the result proves original **control flow given those replies**, not
native INI parsing, CRT edge behavior, allocation or text conversion. The
browser admits ASCII language identifiers and terminated text below the native
1024-cell scratch capacity. Its conservative filename limit is 255 UTF-16
cells; this is a safety boundary, not a recovered game rule. Relative offsets
must not wrap. Recycling an active nested-prefix scratch buffer is explicitly
unsupported, while ordinary sequential ring reuse is supported.

The [saved declaration census](native-static-actor-bounds-evidence.md#volume-construction-and-property-declarations)
finds only Volume.LocationName localized in the inspected ancestry. That does
not yet prove its current linked offset, configuration context or effects.
Next are the original string ImportText/assignment path, current class linking
and the actual volume/world startup join. Existing standalone release ZIPs are
unchanged; this page, module and native verifier are repository Elbera Tools.
